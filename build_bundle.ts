import {
  OnResolveArgs,
  PluginBuild,
} from "https://deno.land/x/esbuild@v0.17.18/mod.js";
import { denoPlugins, esbuild } from "./plugos/deps.ts";

const ENABLE_COLLAB = !Deno.env.get("SB_NO_COLLAB");

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
    // ESBuild plugin to make npm modules external
    {
      name: "npm-external",
      setup(build: any) {
        build.onResolve({ filter: /^npm:/ }, (args: any) => {
          return {
            path: args.path,
            external: true,
          };
        });
      },
    },
    {
      name: "collab-feature-flag",
      setup(build: PluginBuild) {
        build.onResolve({ filter: /^\.\/collab\// }, (args: OnResolveArgs) => {
          const absPath = `${args.resolveDir}/${args.path}`;
          if (ENABLE_COLLAB) {
            // default is hocuspocus collab server
            return {
              path: absPath,
            };
          } else {
            return {
              path: absPath.replace(/collab\/[^.]+\.ts/, "collab/noop.ts"),
            };
          }
        });
      },
    },
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
