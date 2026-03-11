import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

export async function buildPlugCompile(): Promise<void> {
  await mkdir("dist", { recursive: true });

  // Pre-bundle the worker runtime so it can be embedded into plug-compile.js
  // as a string constant. This way the bundled CLI is fully self-contained.
  const workerBuild = await esbuild.build({
    entryPoints: ["client/plugos/worker_runtime.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    treeShaking: true,
  });
  const workerRuntimeJS = workerBuild.outputFiles[0].text;

  const result = await esbuild.build({
    entryPoints: ["./bin/plug-compile.ts"],
    outfile: "dist/plug-compile.js",
    format: "esm",
    banner: {
      js: "#!/usr/bin/env node",
    },
    platform: "node",
    absWorkingDir: process.cwd(),
    bundle: true,
    metafile: false,
    treeShaking: true,
    logLevel: "error",
    minify: false, // Don't minify for better debugging
    define: {
      __EMBEDDED_WORKER_RUNTIME_JS__: JSON.stringify(workerRuntimeJS),
    },
    // Mark all npm packages as external - they'll be installed by npm
    external: [
      "esbuild",
      "commander",
      "js-yaml",
      "sass",
    ],
  });
  if (result.metafile) {
    const text = await esbuild.analyzeMetafile(result.metafile!);
    console.log("Bundle info", text);
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  await buildPlugCompile();
  await esbuild.stop();
}
