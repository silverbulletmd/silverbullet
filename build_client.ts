import { copy } from "@std/fs";
import { fileURLToPath } from "node:url";

import sass from "denosass";

import { patchDenoLibJS } from "./client/plugos/plug_compile.ts";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import * as esbuild from "esbuild";

// This builds the client and puts it into dist_client_bundle/

export async function bundleAll(): Promise<void> {
  await buildCopyBundleAssets();
}

export async function copyAssets(dist: string) {
  await Deno.mkdir(dist, { recursive: true });
  await copy("client/fonts", `${dist}`, { overwrite: true });
  await copy("client/index.html", `${dist}/index.html`, {
    overwrite: true,
  });
  await copy("client/auth.html", `${dist}/auth.html`, {
    overwrite: true,
  });
  await copy("client/images/favicon.png", `${dist}/favicon.png`, {
    overwrite: true,
  });
  await copy("client/images/logo.png", `${dist}/logo.png`, {
    overwrite: true,
  });
  await copy("client/images/logo-dock.png", `${dist}/logo-dock.png`, {
    overwrite: true,
  });

  const compiler = sass(
    Deno.readTextFileSync("client/styles/main.scss"),
    {
      load_paths: ["client/styles"],
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
  await Deno.mkdir("dist_base_fs_bundle", { recursive: true });

  console.log("Now ESBuilding the client and service workers...");

  const result = await esbuild.build({
    entryPoints: [
      {
        in: "client/boot.ts",
        out: ".client/client",
      },
      {
        in: "client/service_worker.ts",
        out: "service_worker",
      },
    ],
    outdir: "dist_client_bundle",
    absWorkingDir: Deno.cwd(),
    bundle: true,
    treeShaking: true,
    sourcemap: Deno.args[0] === "--production" ? undefined : "linked",
    minify: true,
    jsxFactory: "h",
    // metafile: true,
    jsx: "automatic",
    jsxFragment: "Fragment",
    jsxImportSource: "npm:preact@10.23.1",
    plugins: denoPlugins({
      configPath: fileURLToPath(new URL("./deno.json", import.meta.url)),
      nodeModulesDir: "auto",
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

  console.log("Built!");
}

if (import.meta.main) {
  await bundleAll();
  esbuild.stop();
}
