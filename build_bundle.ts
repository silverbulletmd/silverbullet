import { denoPlugins, esbuild } from "./plugos/deps.ts";

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
  minify: false,
  plugins: [
    {
      name: "json",
      setup: (build) =>
        build.onLoad({ filter: /\.json$/ }, () => ({ loader: "json" })),
    },

    ...denoPlugins({
      importMapURL: new URL("./import_map.json", import.meta.url)
        .toString(),
    }),
  ],
});
const bundleJs = await Deno.readTextFile("dist/silverbullet.js");
// Patch output JS with import.meta.main override to avoid ESBuild CLI handling
await Deno.writeTextFile(
  "dist/silverbullet.js",
  "import.meta.main = false;\n" + bundleJs,
);
console.log("Output in dist/silverbullet.js");
esbuild.stop();
