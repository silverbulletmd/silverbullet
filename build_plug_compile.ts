import { mkdir } from "node:fs/promises";
import * as esbuild from "esbuild";

await mkdir("dist", { recursive: true });
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
  // Mark all npm packages as external - they'll be installed by npm
  external: [
    "esbuild",
    "commander",
    "js-yaml",
    "picomatch",
    "sass",
    "fast-glob",
  ],
});
if (result.metafile) {
  const text = await esbuild.analyzeMetafile(result.metafile!);
  console.log("Bundle info", text);
}
// const plugBundleJS = await readFile("dist/plug-compile.js", "utf-8");
// Patch output JS with import.meta.main override to avoid ESBuild CLI handling
// await writeFile(
//   "dist/plug-compile.js",
//   "import.meta.main = false;\n" + plugBundleJS,
//   "utf-8",
// );
console.log("Output in dist");
esbuild.stop();
