import * as path from "node:path";
import { readFile, writeFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as YAML from "js-yaml";

import * as esbuild from "esbuild";
import { bundleAssets } from "../asset_bundle/builder.ts";
import type { Manifest } from "./types.ts";
import { version } from "../../version.ts";

import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

// Read the pre-built worker_runtime bundle
// When running from source: ../../dist/worker_runtime_bundle.js (from client/plugos/)
// When bundled: ./worker_runtime_bundle.js (from dist/)
const currentDir = dirname(fileURLToPath(import.meta.url));
const bundledPath = path.join(currentDir, "worker_runtime_bundle.js");
const sourcePath = path.join(currentDir, "../../dist/worker_runtime_bundle.js");

const workerRuntimeBundlePath = existsSync(bundledPath) ? bundledPath : sourcePath;
const workerRuntimeBundle = readFileSync(workerRuntimeBundlePath, "utf-8");

// Create a data URL so esbuild can inline it
const workerRuntimeUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(workerRuntimeBundle)}`;

export type CompileOptions = {
  debug?: boolean;
  runtimeUrl?: string;
  // Print info on bundle size
  info?: boolean;
};

export async function compileManifest(
  manifestPath: string,
  destPath: string,
  options: CompileOptions = {},
): Promise<string> {
  const rootPath = path.dirname(manifestPath);
  const manifestContent = await readFile(manifestPath, "utf-8");
  const manifest = YAML.load(manifestContent) as Manifest<any>;

  if (!manifest.name) {
    throw new Error(`Missing 'name' in ${manifestPath}`);
  }

  // Assets
  const assetsBundle = await bundleAssets(
    path.resolve(rootPath),
    manifest.assets as string[] || [],
  );
  manifest.assets = assetsBundle.toJSON();

  // Normalize the edge case of a plug with no functions
  if (!manifest.functions) {
    manifest.functions = {};
  }

  const jsFile = `
import { setupMessageListener } from "${
    options.runtimeUrl || workerRuntimeUrl
  }";

// Imports
${
    Object.entries(manifest.functions).map(([funcName, def]) => {
      if (!def.path) {
        return "";
      }
      let [filePath, jsFunctionName] = def.path.split(":");
      // Resolve path
      filePath = path.join(rootPath, filePath);

      return `import {${jsFunctionName} as ${funcName}} from "${
        // Replacing \ with / for Windows
        path.resolve(filePath).replaceAll(
          "\\",
          "\\\\",
        )}";\n`;
    }).join("")
  }

// Function mapping
const functionMapping = {
${
    Object.entries(manifest.functions).map(([funcName, def]) => {
      if (!def.path) {
        return "";
      }
      return `  ${funcName}: ${funcName},\n`;
    }).join("")
  }
};

// Manifest
const manifest = ${JSON.stringify(manifest, null, 2)};

export const plug = {manifest, functionMapping};

setupMessageListener(functionMapping, manifest, self.postMessage);
`;

  // console.log("Code:", jsFile);

  const tempDir = await mkdtemp(path.join(tmpdir(), "plug-compile-"));
  const inFile = path.join(tempDir, "input.js");
  const outFile = `${destPath}/${manifest.name}.plug.js`;
  await writeFile(inFile, jsFile, "utf-8");

  const result = await esbuild.build({
    entryPoints: [inFile],
    bundle: true,
    format: "esm",
    globalName: "mod",
    platform: "browser",
    sourcemap: "linked",
    minify: !options.debug,
    outfile: outFile,
    metafile: options.info,
    treeShaking: true,
  });

  if (options.info) {
    const text = await esbuild.analyzeMetafile(result.metafile!);
    console.log("Bundle info for", manifestPath, text);
  }

  let jsCode = await readFile(outFile, "utf-8");
  jsCode = patchDenoLibJS(jsCode);
  await writeFile(outFile, jsCode, "utf-8");
  
  // Clean up temp directory
  await rm(tempDir, { recursive: true, force: true });
  
  console.log(`Plug ${manifest.name} written to ${outFile}.`);
  return outFile;
}

export async function compileManifests(
  manifestFiles: string[],
  dist: string,
  options: CompileOptions = {},
) {
  let building = false;
  dist = path.resolve(dist);

  async function buildAll() {
    if (building) {
      return;
    }
    console.log("Building", manifestFiles);
    building = true;
    await mkdir(dist, { recursive: true });
    const startTime = Date.now();
    // Build all plugs in parallel
    await Promise.all(manifestFiles.map(async (plugManifestPath) => {
      const manifestPath = plugManifestPath as string;
      try {
        await compileManifest(
          manifestPath,
          dist,
          options,
        );
      } catch (e: any) {
        console.error(`Error building ${manifestPath}:`, e.message);
        throw e;
      }
    }));
    console.log(`Done building plugs in ${Date.now() - startTime}ms`);
    building = false;
  }

  await buildAll();
}

export function patchDenoLibJS(code: string): string {
  // The Deno std lib has one occurence of a regex that Webkit JS doesn't (yet parse), we'll strip it because it's likely never invoked anyway, YOLO
  return code.replaceAll("/(?<=\\n)/", "/()/");
}

export async function plugCompileCommand(
  { dist, debug, info, runtimeUrl }: {
    dist: string;
    debug: boolean;
    info: boolean;
    runtimeUrl?: string;
  },
  ...manifestPaths: string[]
) {
  await compileManifests(
    manifestPaths,
    dist,
    {
      debug: debug,
      info: info,
      runtimeUrl,
    },
  );
  esbuild.stop();
  process.exit(0);
}
