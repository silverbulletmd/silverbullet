import * as path from "node:path";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import * as YAML from "js-yaml";

import * as esbuild from "esbuild";
import * as sass from "sass";
import { bundleAssets } from "../asset_bundle/builder.ts";
import type { BuildStep, Manifest } from "./types.ts";

// When bundled by build_plug_compile.ts, this is replaced with the pre-bundled
// worker runtime JS. When running from source, it's undefined and esbuild
// resolves the .ts file directly (it handles TypeScript natively).
declare const __EMBEDDED_WORKER_RUNTIME_JS__: string | undefined;

const workerRuntimePlugin: esbuild.Plugin = {
  name: "worker-runtime",
  setup(build) {
    if (typeof __EMBEDDED_WORKER_RUNTIME_JS__ !== "undefined") {
      // Bundled CLI: serve pre-bundled JS from the embedded constant
      build.onResolve({ filter: /^worker-runtime$/ }, () => ({
        path: "worker-runtime",
        namespace: "worker-runtime",
      }));
      build.onLoad({ filter: /.*/, namespace: "worker-runtime" }, () => ({
        contents: __EMBEDDED_WORKER_RUNTIME_JS__,
        loader: "js",
      }));
    } else {
      // From source: point directly at the .ts file, esbuild handles it
      build.onResolve({ filter: /^worker-runtime$/ }, () => ({
        path: path.join(import.meta.dirname, "worker_runtime.ts"),
      }));
    }
  },
};

export type CompileOptions = {
  debug?: boolean;
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

  // Build steps (run before asset bundling so produced files can be picked
  // up by the `assets` glob).
  if (manifest.build) {
    await Promise.all(
      manifest.build.map((step) => runBuildStep(step, rootPath, options)),
    );
    delete manifest.build;
  }

  // Assets
  const assetsBundle = await bundleAssets(
    path.resolve(rootPath),
    (manifest.assets as string[]) || [],
  );
  manifest.assets = assetsBundle.toJSON();

  // Normalize the edge case of a plug with no functions
  if (!manifest.functions) {
    manifest.functions = {};
  }

  const jsFile = `
import { setupMessageListener } from "worker-runtime";

// Imports
${Object.entries(manifest.functions)
  .map(([funcName, def]) => {
    if (!def.path) {
      return "";
    }
    let [filePath, jsFunctionName] = def.path.split(":");
    // Resolve path
    filePath = path.join(rootPath, filePath);

    return `import {${jsFunctionName} as ${funcName}} from "${
      // Replacing \ with / for Windows
      path.resolve(filePath).replaceAll("\\", "\\\\")
    }";\n`;
  })
  .join("")}

// Function mapping
const functionMapping = {
${Object.entries(manifest.functions)
  .map(([funcName, def]) => {
    if (!def.path) {
      return "";
    }
    return `  ${funcName}: ${funcName},\n`;
  })
  .join("")}
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
    plugins: [workerRuntimePlugin],
  });

  if (options.info) {
    const text = await esbuild.analyzeMetafile(result.metafile!);
    console.log("Bundle info for", manifestPath, text);
  }

  let jsCode = await readFile(outFile, "utf-8");
  jsCode = patchBundledJS(jsCode);
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
    await Promise.all(
      manifestFiles.map(async (plugManifestPath) => {
        const manifestPath = plugManifestPath as string;
        try {
          await compileManifest(manifestPath, dist, options);
        } catch (e: any) {
          console.error(`Error building ${manifestPath}:`, e.message);
          throw e;
        }
      }),
    );
    console.log(`Done building plugs in ${Date.now() - startTime}ms`);
    building = false;
  }

  await buildAll();
}

async function runBuildStep(
  step: BuildStep,
  rootPath: string,
  options: CompileOptions,
) {
  const type = step.type ?? "esbuild";
  const inFile = path.resolve(rootPath, step.in);
  const outFile = path.resolve(rootPath, step.out);
  await mkdir(path.dirname(outFile), { recursive: true });
  if (type === "esbuild") {
    await esbuild.build({
      entryPoints: [inFile],
      bundle: true,
      format: "iife",
      platform: "browser",
      minify: !options.debug,
      outfile: outFile,
      treeShaking: true,
    });
  } else if (type === "sass") {
    const scss = await readFile(inFile, "utf-8");
    const result = sass.compileString(scss, {
      loadPaths: [path.dirname(inFile)],
      style: options.debug ? "expanded" : "compressed",
    });
    await writeFile(outFile, result.css, "utf-8");
  } else if (type === "copy") {
    await copyFile(inFile, outFile);
  } else {
    throw new Error(`Unsupported build step type: ${type}`);
  }
}

export function patchBundledJS(code: string): string {
  // One bundled dependency has a lookbehind regex that WebKit can't parse; replace it with a no-op
  return code.replaceAll("/(?<=\\n)/", "/()/");
}

export async function plugCompileCommand(
  {
    dist,
    debug,
    info,
  }: {
    dist: string;
    debug: boolean;
    info: boolean;
  },
  ...manifestPaths: string[]
) {
  await compileManifests(manifestPaths, dist, {
    debug: debug,
    info: info,
  });
  await esbuild.stop();
  process.exit(0);
}
