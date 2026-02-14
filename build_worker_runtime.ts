import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";

// Build worker_runtime.ts into a standalone JS file
await esbuild.build({
  entryPoints: [fileURLToPath(new URL("./client/plugos/worker_runtime.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: "dist/worker_runtime_bundle.js",
  minify: false,
  treeShaking: true,
});

console.log("Built worker_runtime_bundle.js");
