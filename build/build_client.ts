import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as sass from "sass";

import * as esbuild from "esbuild";

import { patchBundledJS } from "../client/plugos/plug_compile.ts";

// This builds the client and puts it into client_bundle/client

export async function buildClient(): Promise<void> {
  await mkdir("client_bundle/client", { recursive: true });
  await mkdir("client_bundle/base_fs", { recursive: true });

  console.log("Now ESBuilding the client and service workers...");

  const baseBuildConfig: esbuild.BuildOptions = {
    outdir: "client_bundle/client",
    absWorkingDir: process.cwd(),
    bundle: true,
    treeShaking: true,
    sourcemap: "linked",
    minify: true,
    jsxFactory: "h",
    // metafile: true,
    format: "esm",
    chunkNames: ".client/[name]-[hash]",
    jsx: "automatic",
    jsxFragment: "Fragment",
    jsxImportSource: "preact",
  }

  const buildConfigs: Array<[String, esbuild.BuildOptions]> = [
    ["client", {
      ...baseBuildConfig,
      entryPoints: [
        {
          in: "client/boot.ts",
          out: ".client/client",
        }
      ],
      splitting: true
    }],
    ["service worker", {
      ...baseBuildConfig,
      entryPoints: [
        {
          in: "client/service_worker.ts",
          out: "service_worker",
        },
      ],
      splitting: false
    }]
  ]

  for (const [buildName, buildConfig] of buildConfigs) {
    const result = await esbuild.build(buildConfig)

    if (result.metafile) {
      const text = await esbuild.analyzeMetafile(result.metafile!);
      console.log(`Bundle info for ${buildName}`, text);
    }
  }

  await copyAssets("client_bundle/client/.client");
  await patchServiceWorker();

  console.log("Built!");
}

export async function buildClientStatic(): Promise<void> {
  // Build client in local mode for static GitHub Pages deployment
  // This produces output in client_bundle/static/ suitable for hosting on GH Pages
  const outDir = "client_bundle/static";
  const assetDir = "client"; // no leading dot — GitHub Pages won't serve dotdirs
  await mkdir(outDir, { recursive: true });
  await mkdir(`${outDir}/${assetDir}`, { recursive: true });

  console.log("Building static SilverBullet client for GitHub Pages...");

  const baseBuildConfig: esbuild.BuildOptions = {
    outdir: outDir,
    absWorkingDir: process.cwd(),
    bundle: true,
    treeShaking: true,
    sourcemap: "linked",
    minify: true,
    jsxFactory: "h",
    format: "esm",
    chunkNames: `${assetDir}/[name]-[hash]`,
    jsx: "automatic",
    jsxFragment: "Fragment",
    jsxImportSource: "preact",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  };

  await esbuild.build({
    ...baseBuildConfig,
    entryPoints: [{
      in: "client/boot.ts",
      out: `${assetDir}/client`,
    }],
    splitting: true,
  });

  // Build a local-mode service worker (no sync engine)
  await esbuild.build({
    ...baseBuildConfig,
    entryPoints: [{
      in: "client/service_worker.ts",
      out: "service_worker",
    }],
    splitting: false,
  });

  // Copy assets
  await cp("client/fonts", `${outDir}/${assetDir}/fonts`, { recursive: true });
  await cp("client/images/favicon-96x96.png", `${outDir}/${assetDir}/favicon-96x96.png`);
  await cp("client/images/favicon.svg", `${outDir}/${assetDir}/favicon.svg`);
  await cp("client/images/favicon.ico", `${outDir}/${assetDir}/favicon.ico`);
  await cp("client/images/apple-touch-icon.png", `${outDir}/${assetDir}/apple-touch-icon.png`);
  await cp("client/images/logo.png", `${outDir}/${assetDir}/logo.png`);
  await cp("client/images/logo-dock.png", `${outDir}/${assetDir}/logo-dock.png`);

  // Use local-mode index.html (static, no templates)
  await cp("client/html/index.local.html", `${outDir}/index.html`);

  // Static manifest.json
  await cp("client/html/manifest.json", `${outDir}/${assetDir}/manifest.json`);

  // Compile CSS
  const scssContent = await readFile("client/styles/main.scss", "utf-8");
  const result = sass.compileString(scssContent, {
    loadPaths: ["client/styles"],
    style: "compressed",
  });
  await writeFile(`${outDir}/${assetDir}/main.css`, result.css, "utf-8");

  const componentsScss = await readFile(
    "client/styles/components_bundle.scss",
    "utf-8",
  );
  const componentsResult = sass.compileString(componentsScss, {
    loadPaths: ["client/styles"],
    style: "compressed",
  });
  await writeFile(`${outDir}/${assetDir}/components.css`, componentsResult.css, "utf-8");

  // Patch the JS
  let bundleJs = await readFile(`${outDir}/${assetDir}/client.js`, "utf-8");
  bundleJs = patchBundledJS(bundleJs);
  await writeFile(`${outDir}/${assetDir}/client.js`, bundleJs, "utf-8");

  // Scan asset directory to build the full precache file list
  const allFiles = await readdir(`${outDir}/${assetDir}`);
  const precacheFiles = [
    "/",
    `/${assetDir}/manifest.json`,
    ...allFiles
      .filter(
        (f) =>
          !f.endsWith(".map") &&
          f !== "auth.html" &&
          f !== "index.html" &&
          f !== "LICENSE.md",
      )
      .map((f) => `/${assetDir}/${f}`),
  ];
  const precacheFilesStr = precacheFiles.join(",");

  // Patch the service worker
  let swCode = await readFile(`${outDir}/service_worker.js`, "utf-8");
  swCode = swCode.replaceAll("{{CACHE_NAME}}", `cache-${Date.now()}`);
  swCode = swCode.replaceAll("{{PRECACHE_FILES}}", precacheFilesStr);
  await writeFile(`${outDir}/service_worker.js`, swCode, "utf-8");

  console.log(`Static export built in ${outDir}/`);
}

async function copyAssets(dist: string) {
  await mkdir(dist, { recursive: true });
  await cp("client/fonts", dist, { recursive: true });
  await cp("client/html", dist, { recursive: true });
  await cp("client/images/favicon-96x96.png", `${dist}/favicon-96x96.png`);
  await cp("client/images/favicon.svg", `${dist}/favicon.svg`);
  await cp("client/images/favicon.ico", `${dist}/favicon.ico`);
  await cp("client/images/apple-touch-icon.png", `${dist}/apple-touch-icon.png`);
  await cp("client/images/logo.png", `${dist}/logo.png`);
  await cp("client/images/logo-dock.png", `${dist}/logo-dock.png`);

  const scssContent = await readFile("client/styles/main.scss", "utf-8");
  const result = sass.compileString(scssContent, {
    loadPaths: ["client/styles"],
    style: "compressed",
  });
  await writeFile(`${dist}/main.css`, result.css, "utf-8");

  const componentsScss = await readFile(
    "client/styles/components_bundle.scss",
    "utf-8",
  );
  const componentsResult = sass.compileString(componentsScss, {
    loadPaths: ["client/styles"],
    style: "compressed",
  });
  await writeFile(`${dist}/components.css`, componentsResult.css, "utf-8");

  // HACK: Patch the JS by removing an invalid regex
  let bundleJs = await readFile(`${dist}/client.js`, "utf-8");
  bundleJs = patchBundledJS(bundleJs);
  await writeFile(`${dist}/client.js`, bundleJs, "utf-8");
}

async function patchServiceWorker() {
  // Scan .client/ directory to build the full precache file list
  const clientDir = "client_bundle/client/.client";
  const allFiles = await readdir(clientDir);
  const precacheFiles = [
    "/", // The index page
    "/.client/manifest.json", // Dynamically generated by the server, but needed for PWA
    ...allFiles
      .filter(
        (f) =>
          !f.endsWith(".map") &&
          f !== "auth.html" &&
          f !== "index.html" &&
          f !== "LICENSE.md",
      )
      .map((f) => `/.client/${f}`),
  ];
  const precacheFilesStr = precacheFiles.join(",");

  // Patch the service_worker {{CACHE_NAME}} and {{PRECACHE_FILES}}
  let swCode = await readFile(
    "client_bundle/client/service_worker.js",
    "utf-8",
  );
  swCode = swCode.replaceAll("{{CACHE_NAME}}", `cache-${Date.now()}`);
  swCode = swCode.replaceAll("{{PRECACHE_FILES}}", precacheFilesStr);
  await writeFile("client_bundle/client/service_worker.js", swCode, "utf-8");
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("--static")) {
    await buildClientStatic();
  } else {
    await buildClient();
  }
  await esbuild.stop();
}
