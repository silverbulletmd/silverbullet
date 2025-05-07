import { denoPlugins } from "@luca/esbuild-deno-loader";
import * as esbuild from "esbuild";

import { updateVersionFile } from "./update_version.ts";

await updateVersionFile();
await Deno.mkdir("dist", { recursive: true });
await esbuild.build({
  entryPoints: {
    silverbullet: "silverbullet.ts",
  },
  outdir: "dist",
  format: "esm",
  absWorkingDir: Deno.cwd(),
  bundle: true,
  treeShaking: true,
  sourcemap: false,
  logLevel: "error",
  minify: true,
  external: [],
  plugins: denoPlugins({
    configPath: new URL("./deno.json", import.meta.url).pathname,
  }),
});
const bundleJs = await Deno.readTextFile("dist/silverbullet.js");
// Patch output JS with import.meta.main override to avoid ESBuild CLI handling
await Deno.writeTextFile(
  "dist/silverbullet.js",
  "import.meta.main = false;\n" + bundleJs,
);
console.log("Output in dist/silverbullet.js");
esbuild.stop();
