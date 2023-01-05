// -- esbuild --
// @deno-types="https://deno.land/x/esbuild@v0.14.54/mod.d.ts"
import * as esbuildWasm from "https://deno.land/x/esbuild@v0.14.54/wasm.js";
import * as esbuildNative from "https://deno.land/x/esbuild@v0.14.54/mod.js";
import { denoPlugin } from "https://deno.land/x/esbuild_deno_loader@0.6.0/mod.ts"; //"./esbuild_deno_loader/mod.ts";
import { copy } from "https://deno.land/std@0.165.0/fs/copy.ts";

import sass from "https://deno.land/x/denosass@1.0.4/mod.ts";
import { bundleFolder } from "./plugos/asset_bundle/builder.ts";
import { patchDenoLibJS } from "./plugos/hack.ts";
import { bundle as plugOsBundle } from "./plugos/bin/plugos-bundle.ts";

import * as flags from "https://deno.land/std@0.165.0/flags/mod.ts";

// @ts-ignore trust me
export const esbuild: typeof esbuildWasm = Deno.run === undefined
  ? esbuildWasm
  : esbuildNative;

export async function prepareAssets(dist: string) {
  await copy("web/fonts", `${dist}`, { overwrite: true });
  await copy("web/index.html", `${dist}/index.html`, {
    overwrite: true,
  });
  await copy("web/auth.html", `${dist}/auth.html`, {
    overwrite: true,
  });
  await copy("web/images/favicon.png", `${dist}/favicon.png`, {
    overwrite: true,
  });
  await copy("web/images/logo.png", `${dist}/logo.png`, {
    overwrite: true,
  });
  await copy("web/manifest.json", `${dist}/manifest.json`, {
    overwrite: true,
  });
  await copy("server/SETTINGS_template.md", `${dist}/SETTINGS_template.md`, {
    overwrite: true,
  });
  const compiler = sass(
    Deno.readTextFileSync("web/styles/main.scss"),
    {
      load_paths: ["web/styles"],
    },
  );
  await Deno.writeTextFile(
    `${dist}/main.css`,
    compiler.to_string("expanded") as string,
  );
  const globalManifest = await plugOsBundle("./plugs/global.plug.yaml");
  await Deno.writeTextFile(
    `${dist}/global.plug.json`,
    JSON.stringify(globalManifest, null, 2),
  );

  // HACK: Patch the JS by removing an invalid regex
  let bundleJs = await Deno.readTextFile(`${dist}/client.js`);
  bundleJs = patchDenoLibJS(bundleJs);
  await Deno.writeTextFile(`${dist}/client.js`, bundleJs);
}

export async function bundle(
  watch: boolean,
  type: "web" | "mobile",
  distDir: string,
): Promise<void> {
  let building = false;
  await doBuild(`${type}/boot.ts`, type === "web");
  let timer;
  if (watch) {
    const watcher = Deno.watchFs([type, "dist_bundle/_plug"]);
    for await (const _event of watcher) {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        console.log("Change detected, rebuilding...");
        doBuild(`${type}/boot.ts`, true);
      }, 1000);
    }
  }

  async function doBuild(
    mainScript: string,
    shouldBundle: boolean,
  ) {
    if (building) {
      return;
    }
    building = true;
    await Promise.all([
      esbuild.build({
        entryPoints: {
          client: mainScript,
          service_worker: "web/service_worker.ts",
          worker: "plugos/environments/sandbox_worker.ts",
        },
        outdir: distDir,
        absWorkingDir: Deno.cwd(),
        bundle: true,
        treeShaking: true,
        sourcemap: "linked",
        minify: true,
        jsxFactory: "h",
        jsx: "automatic",
        jsxFragment: "Fragment",
        jsxImportSource: "https://esm.sh/preact@10.11.1",
        plugins: [
          denoPlugin({
            importMapURL: new URL("./import_map.json", import.meta.url),
          }),
        ],
      }),
    ]);
    await prepareAssets(distDir);

    if (shouldBundle) {
      await bundleFolder("dist_bundle", "dist/asset_bundle.json");
    }

    building = false;
    console.log("Built!");
  }
}

if (import.meta.main) {
  const args = flags.parse(Deno.args, {
    boolean: ["watch"],
    alias: { w: "watch" },
    default: {
      watch: false,
    },
  });
  await bundle(args.watch, "web", "dist_bundle/web");
  if (!args.watch) {
    esbuild.stop();
  }
}
