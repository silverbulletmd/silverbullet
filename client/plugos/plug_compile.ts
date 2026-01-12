import * as path from "@std/path";
import * as YAML from "@std/yaml";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import * as esbuild from "esbuild";
import { bundleAssets } from "../asset_bundle/builder.ts";
import type { Manifest } from "./types.ts";
import { version } from "../../version.ts";

// const workerRuntimeUrl = new URL(
//   "../lib/plugos/worker_runtime.ts",
//   import.meta.url,
// );
const workerRuntimeUrl =
  `https://deno.land/x/silverbullet@${version}/client/plugos/worker_runtime.ts`;

// Known SHA-256 checksums for worker_runtime.ts by version
const WORKER_RUNTIME_CHECKSUMS: Record<string, string> = {
  "2.3.0": "0237c0c2d689bb47fc7561f835d081d8cc582b047b5867bea6e8c0b073b4ed55",
  "2.2.1": "0237c0c2d689bb47fc7561f835d081d8cc582b047b5867bea6e8c0b073b4ed55",
  "2.2.0": "0237c0c2d689bb47fc7561f835d081d8cc582b047b5867bea6e8c0b073b4ed55",
  "2.1.9": "0237c0c2d689bb47fc7561f835d081d8cc582b047b5867bea6e8c0b073b4ed55",
  "2.1.8": "0237c0c2d689bb47fc7561f835d081d8cc582b047b5867bea6e8c0b073b4ed55",
  "2.1.7": "0237c0c2d689bb47fc7561f835d081d8cc582b047b5867bea6e8c0b073b4ed55",
  "2.1.6": "0237c0c2d689bb47fc7561f835d081d8cc582b047b5867bea6e8c0b073b4ed55",
  "2.1.5": "0371f6d8f007222b397dfe72a5b8b2e02f38f3521b9317d695f3f0a46e2310e1",
  "2.1.4": "0371f6d8f007222b397dfe72a5b8b2e02f38f3521b9317d695f3f0a46e2310e1",
  "2.1.3": "0371f6d8f007222b397dfe72a5b8b2e02f38f3521b9317d695f3f0a46e2310e1",
  "2.1.2": "0371f6d8f007222b397dfe72a5b8b2e02f38f3521b9317d695f3f0a46e2310e1",
  "2.1.1": "0371f6d8f007222b397dfe72a5b8b2e02f38f3521b9317d695f3f0a46e2310e1",
  "2.1.0": "0371f6d8f007222b397dfe72a5b8b2e02f38f3521b9317d695f3f0a46e2310e1",
  "2.0.0": "7d04f7431bbfa41a04bcc7e6b98b9de0d919756c4c671c5785c99fff45f16402",
};

export type CompileOptions = {
  debug?: boolean;
  runtimeUrl?: string;
  // path to config file
  configPath?: string;
  // path to import map
  importMap?: string;
  // Print info on bundle size
  info?: boolean;
};

async function verifyWorkerRuntimeChecksum(
  runtimeUrl: string,
  version: string,
): Promise<void> {
  // Only verify 2.x versions
  if (!version.startsWith("2.")) {
    return;
  }

  const expectedChecksum = WORKER_RUNTIME_CHECKSUMS[version];
  if (!expectedChecksum) {
    console.warn(
      `Warning: No checksum available for worker_runtime.ts version ${version}. Skipping verification.`,
    );
    return;
  }

  try {
    // Fetch the runtime file
    const response = await fetch(runtimeUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch worker_runtime.ts: ${response.status} ${response.statusText}`,
      );
    }

    const runtimeContent = await response.text();

    // Calculate SHA-256 hash
    const encoder = new TextEncoder();
    const data = encoder.encode(runtimeContent);
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const actualChecksum = hashArray.map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Verify checksum matches
    if (actualChecksum !== expectedChecksum) {
      throw new Error(
        `Worker runtime checksum mismatch for version ${version}!\n` +
          `Expected: ${expectedChecksum}\n` +
          `Actual:   ${actualChecksum}\n` +
          `This may indicate the runtime has been tampered with or incorrectly published.`,
      );
    }

    console.log(`✓ Worker runtime checksum verified for version ${version}`);
  } catch (error) {
    throw new Error(
      `Worker runtime verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function compileManifest(
  manifestPath: string,
  destPath: string,
  options: CompileOptions = {},
): Promise<string> {
  const rootPath = path.dirname(manifestPath);
  const manifest = YAML.parse(
    await Deno.readTextFile(manifestPath),
  ) as Manifest<any>;

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

      return `import {${jsFunctionName} as ${funcName}} from "file://${
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

  const inFile = await Deno.makeTempFile({ suffix: ".js" });
  const outFile = `${destPath}/${manifest.name}.plug.js`;
  await Deno.writeTextFile(inFile, jsFile);

  // Verify worker runtime checksum before bundling
  const runtimeUrlToVerify = options.runtimeUrl || workerRuntimeUrl;
  await verifyWorkerRuntimeChecksum(runtimeUrlToVerify, version);

  const result = await esbuild.build({
    entryPoints: [path.basename(inFile)],
    bundle: true,
    format: "esm",
    globalName: "mod",
    platform: "browser",
    sourcemap: "linked",
    minify: !options.debug,
    outfile: outFile,
    metafile: options.info,
    treeShaking: true,
    plugins: [
      ...denoPlugins({
        configPath: options.configPath &&
          path.resolve(Deno.cwd(), options.configPath),
        importMapURL: options.importMap,
      }),
    ],
    absWorkingDir: path.resolve(path.dirname(inFile)),
  });

  if (options.info) {
    const text = await esbuild.analyzeMetafile(result.metafile!);
    console.log("Bundle info for", manifestPath, text);
  }

  let jsCode = await Deno.readTextFile(outFile);
  jsCode = patchDenoLibJS(jsCode);
  await Deno.writeTextFile(outFile, jsCode);
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
    Deno.mkdirSync(dist, { recursive: true });
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
  { dist, debug, info, importmap, config, runtimeUrl }: {
    dist: string;
    debug: boolean;
    info: boolean;
    importmap?: string;
    config?: string;
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
      importMap: importmap
        ? new URL(importmap, `file://${Deno.cwd()}/`).toString()
        : undefined,
      configPath: config,
    },
  );
  esbuild.stop();
  Deno.exit(0);
}
