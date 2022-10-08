// -- esbuild --
// @deno-types="https://deno.land/x/esbuild@v0.14.54/mod.d.ts"
import * as esbuildWasm from "https://deno.land/x/esbuild@v0.14.54/wasm.js";
import * as esbuildNative from "https://deno.land/x/esbuild@v0.14.54/mod.js";
import { denoPlugin } from "./packages/esbuild_deno_loader/mod.ts";
import { copy } from "https://deno.land/std@0.158.0/fs/copy.ts";

import sass from "https://deno.land/x/denosass@1.0.4/mod.ts";
import { bundleFolder } from "./json_bundle.ts";
import { patchDenoLibJS } from "./packages/common/hack.ts";

// @ts-ignore trust me
const esbuild: typeof esbuildWasm = Deno.run === undefined
  ? esbuildWasm
  : esbuildNative;

async function prepareAssets(dest: string) {
  await copy("packages/web/fonts", dest, { overwrite: true });
  await copy("packages/web/index.html", `${dest}/index.html`, {
    overwrite: true,
  });
  const compiler = sass(
    Deno.readTextFileSync("packages/web/styles/main.scss"),
    {
      load_paths: ["packages/web/styles"],
    },
  );
  await Deno.writeTextFile(
    "dist/main.css",
    compiler.to_string("expanded") as string,
  );
  // await bundleRun({
  //   _: [`${__dirname}../plugs/global.plug.yaml`],
  //   debug: true,
  //   dist: tmpDist,
  //   exclude: [],
  // });

  let bundleJs = await Deno.readTextFile("dist/client.js");
  bundleJs = patchDenoLibJS(bundleJs);
  await Deno.writeTextFile("dist/client.js", bundleJs);

  await bundleFolder("dist", "dist_bundle.json");
}

async function bundle(): Promise<void> {
  await Promise.all([
    esbuild.build({
      entryPoints: {
        "client": "packages/web/boot.ts",
        "worker": "packages/plugos/environments/sandbox_worker.ts",
      },
      outdir: "./dist",
      absWorkingDir: Deno.cwd(),
      bundle: true,
      treeShaking: true,
      sourcemap: "linked",
      watch: {
        onRebuild(error, result) {
          if (error) {
            console.error("watch build failed:", error);
          } else {
            console.log("watch build succeeded.");
          }
          prepareAssets("dist").catch(console.error);
        },
      },
      plugins: [
        denoPlugin({
          importMapURL: new URL("./import_map.json", import.meta.url),
        }),
      ],
    }),
  ]);
  await prepareAssets("dist");
  console.log("Built!");
}
await bundle();
// esbuild.stop();
