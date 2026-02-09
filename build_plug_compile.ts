import { denoPlugin, esbuild } from "./build_deps.ts";

await Deno.mkdir("dist", { recursive: true });
const result = await esbuild.build({
  entryPoints: {
    "plug-compile": "./bin/plug-compile.ts",
  },
  outdir: "dist",
  format: "esm",
  absWorkingDir: Deno.cwd(),
  bundle: true,
  metafile: false,
  treeShaking: true,
  logLevel: "error",
  minify: true,
  external: [
    // Exclude weird yarn detection modules
    "pnpapi",
    // Exclude some larger dependencies that can be downloaded on the fly
    "npm:esbuild*",
    "jsr:@deno/esbuild-plugin*",
  ],
  plugins: [denoPlugin({
    configPath: new URL("./deno.json", import.meta.url).pathname,
  })],
});
if (result.metafile) {
  const text = await esbuild.analyzeMetafile(result.metafile!);
  console.log("Bundle info", text);
}
// const plugBundleJS = await Deno.readTextFile("dist/plug-compile.js");
// Patch output JS with import.meta.main override to avoid ESBuild CLI handling
// await Deno.writeTextFile(
//   "dist/plug-compile.js",
//   "import.meta.main = false;\n" + plugBundleJS,
// );
console.log("Output in dist");
esbuild.stop();
