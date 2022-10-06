// -- esbuild --
// @deno-types="https://deno.land/x/esbuild@v0.14.54/mod.d.ts"
import * as esbuildWasm from "https://deno.land/x/esbuild@v0.14.54/wasm.js";
import * as esbuildNative from "https://deno.land/x/esbuild@v0.14.54/mod.js";
import { denoPlugin } from "./packages/esbuild_deno_loader/mod.ts";
import { copy } from "https://deno.land/std@0.158.0/fs/copy.ts";

// import { sassPlugin } from "https://esm.sh/esbuild-sass-plugin@2.3.3";

import sass from "https://deno.land/x/denosass/mod.ts";

// @ts-ignore trust me
const esbuild: typeof esbuildWasm = Deno.run === undefined
  ? esbuildWasm
  : esbuildNative;

async function copyAssets(dest: string) {
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
  await Deno.writeTextFile("dist/main.css", compiler.to_string() as string);
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
          copyAssets("dist").catch(console.error);
        },
      },
      plugins: [
        denoPlugin({
          importMapURL: new URL("./import_map.json", import.meta.url),
        }),
      ],
    }),
  ]);
  await copyAssets("dist");
  console.log("Built!");
}
await bundle();
// esbuild.stop();
