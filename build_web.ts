import { copy } from "$std/fs/copy.ts";

import sass from "denosass";
import { bundleFolder } from "./lib/asset_bundle/builder.ts";

import { parse } from "$std/flags/mod.ts";
import { patchDenoLibJS } from "./cmd/compile.ts";
import { denoPlugins } from "esbuild_deno_loader";
import * as esbuild from "esbuild";

export async function bundleAll(
  watch: boolean,
): Promise<void> {
  let building = false;
  await buildCopyBundleAssets();
  let timer;
  if (watch) {
    const watcher = Deno.watchFs(["web", "dist_plug_bundle"]);
    for await (const _event of watcher) {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        console.log("Change detected, rebuilding...");
        if (building) {
          return;
        }
        building = true;
        buildCopyBundleAssets().finally(() => {
          building = false;
        });
      }, 1000);
    }
  }
}

export async function copyAssets(dist: string) {
  await Deno.mkdir(dist, { recursive: true });
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
  await copy("web/images/logo-dock.png", `${dist}/logo-dock.png`, {
    overwrite: true,
  });
  await copy("web/manifest.json", `${dist}/manifest.json`, {
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

  // HACK: Patch the JS by removing an invalid regex
  let bundleJs = await Deno.readTextFile(`${dist}/client.js`);
  bundleJs = patchDenoLibJS(bundleJs);
  await Deno.writeTextFile(`${dist}/client.js`, bundleJs);
}
async function buildCopyBundleAssets() {
  await Deno.mkdir("dist_client_bundle", { recursive: true });
  await Deno.mkdir("dist_plug_bundle", { recursive: true });

  await bundleFolder(
    "dist_plug_bundle",
    "dist/plug_asset_bundle.json",
  );

  console.log("Now ESBuilding the client and service workers...");

  const result = await esbuild.build({
    entryPoints: [
      {
        in: "web/boot.ts",
        out: ".client/client",
      },
      {
        in: "web/service_worker.ts",
        out: "service_worker",
      },
    ],
    outdir: "dist_client_bundle",
    absWorkingDir: Deno.cwd(),
    bundle: true,
    treeShaking: true,
    sourcemap: "linked",
    minify: true,
    jsxFactory: "h",
    // metafile: true,
    jsx: "automatic",
    jsxFragment: "Fragment",
    jsxImportSource: "https://esm.sh/preact@10.11.1",
    plugins: denoPlugins({
      importMapURL: new URL("./import_map.json", import.meta.url)
        .toString(),
    }),
  });

  if (result.metafile) {
    const text = await esbuild.analyzeMetafile(result.metafile!);
    console.log("Bundle info", text);
  }

  // Patch the service_worker {{CACHE_NAME}}
  let swCode = await Deno.readTextFile("dist_client_bundle/service_worker.js");
  swCode = swCode.replaceAll("{{CACHE_NAME}}", `cache-${Date.now()}`);
  await Deno.writeTextFile("dist_client_bundle/service_worker.js", swCode);

  await copyAssets("dist_client_bundle/.client");
  await bundleFolder("dist_client_bundle", "dist/client_asset_bundle.json");

  console.log("Built!");
}

if (import.meta.main) {
  const args = parse(Deno.args, {
    boolean: ["watch"],
    alias: { w: "watch" },
    default: {
      watch: false,
    },
  });
  await bundleAll(args.watch);
  if (!args.watch) {
    esbuild.stop();
  }
}
