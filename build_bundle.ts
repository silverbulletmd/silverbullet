import { denoPlugins } from "@luca/esbuild-deno-loader";
import * as esbuild from "esbuild";

import { updateVersionFile } from "./cmd/update_version.ts";

await updateVersionFile();
await Deno.mkdir("dist", { recursive: true });
const result = await esbuild.build({
  entryPoints: {
    silverbullet: "silverbullet.ts",
    "plug-compile": "plug-compile.ts",
  },
  outdir: "dist",
  format: "esm",
  absWorkingDir: Deno.cwd(),
  bundle: true,
  //metafile: true,
  treeShaking: true,
  logLevel: "error",
  minify: true,
  external: [],
  plugins: denoPlugins({
    configPath: new URL("./deno.json", import.meta.url).pathname,
    nodeModulesDir: "auto",
  }),
});
if (result.metafile) {
  const text = await esbuild.analyzeMetafile(result.metafile!);
  console.log("Bundle info", text);
}
const plugBundleJS = await Deno.readTextFile("dist/plug-compile.js");
// Patch output JS with import.meta.main override to avoid ESBuild CLI handling
await Deno.writeTextFile(
  "dist/plug-compile.js",
  "import.meta.main = false;\n" + plugBundleJS,
);
console.log("Output in dist");
esbuild.stop();
