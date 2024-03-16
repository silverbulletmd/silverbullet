import { denoPlugins } from "esbuild_deno_loader";
import * as esbuild from "esbuild";

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
  plugins: denoPlugins({
    importMapURL: new URL("./import_map.json", import.meta.url)
      .toString(),
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
