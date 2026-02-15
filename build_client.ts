import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as sass from "sass";

import * as esbuild from "esbuild";

import { patchDenoLibJS } from "./client/plugos/plug_compile.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// This builds the client and puts it into client_bundle/client

export async function bundleAll(): Promise<void> {
  await buildCopyBundleAssets();
}

export async function copyAssets(dist: string) {
  await mkdir(dist, { recursive: true });
  await cp("client/fonts", `${dist}`, { recursive: true });
  await cp("client/html/index.html", `${dist}/index.html`);
  await cp("client/html/auth.html", `${dist}/auth.html`);
  await cp("client/images/favicon.png", `${dist}/favicon.png`);
  await cp("client/images/logo.png", `${dist}/logo.png`);
  await cp("client/images/logo-dock.png", `${dist}/logo-dock.png`);

  const scssContent = await readFile("client/styles/main.scss", "utf-8");
  const result = sass.compileString(scssContent, {
    loadPaths: ["client/styles"],
    style: "expanded",
  });
  await writeFile(`${dist}/main.css`, result.css, "utf-8");

  // HACK: Patch the JS by removing an invalid regex
  let bundleJs = await readFile(`${dist}/client.js`, "utf-8");
  bundleJs = patchDenoLibJS(bundleJs);
  await writeFile(`${dist}/client.js`, bundleJs, "utf-8");
}

async function buildCopyBundleAssets() {
  await mkdir("client_bundle/client", { recursive: true });
  await mkdir("client_bundle/base_fs", { recursive: true });

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
    outdir: "client_bundle/client",
    absWorkingDir: process.cwd(),
    bundle: true,
    treeShaking: true,
    sourcemap: "linked",
    minify: true,
    jsxFactory: "h",
    // metafile: true,
    jsx: "automatic",
    jsxFragment: "Fragment",
    jsxImportSource: "preact",
  });

  if (result.metafile) {
    const text = await esbuild.analyzeMetafile(result.metafile!);
    console.log("Bundle info", text);
  }

  // Patch the service_worker {{CACHE_NAME}}
  let swCode = await readFile(
    "client_bundle/client/service_worker.js",
    "utf-8",
  );
  swCode = swCode.replaceAll("{{CACHE_NAME}}", `cache-${Date.now()}`);
  await writeFile("client_bundle/client/service_worker.js", swCode, "utf-8");

  await copyAssets("client_bundle/client/.client");

  console.log("Built!");
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  await bundleAll();
  esbuild.stop();
}
