import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import * as sass from "sass";

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
  };

  const buildConfigs: Array<[String, esbuild.BuildOptions]> = [
    [
      "client",
      {
        ...baseBuildConfig,
        entryPoints: [
          {
            in: "client/boot.ts",
            out: ".client/client",
          },
        ],
        splitting: true,
      },
    ],
    [
      "service worker",
      {
        ...baseBuildConfig,
        entryPoints: [
          {
            in: "client/service_worker.ts",
            out: "service_worker",
          },
        ],
        splitting: false,
      },
    ],
    [
      "spaces ui",
      {
        ...baseBuildConfig,
        entryPoints: [
          {
            in: "client/spaces_ui/spaces.tsx",
            out: ".client/spaces",
          },
        ],
        splitting: false,
      },
    ],
    [
      "setup ui",
      {
        ...baseBuildConfig,
        entryPoints: [
          {
            in: "client/spaces_ui/setup.tsx",
            out: ".client/setup",
          },
        ],
        splitting: false,
      },
    ],
    [
      "auth ui",
      {
        ...baseBuildConfig,
        entryPoints: [
          {
            in: "client/spaces_ui/auth.tsx",
            out: ".client/auth",
          },
        ],
        splitting: false,
      },
    ],
  ];

  for (const [buildName, buildConfig] of buildConfigs) {
    const result = await esbuild.build(buildConfig);

    if (result.metafile) {
      const text = await esbuild.analyzeMetafile(result.metafile!);
      console.log(`Bundle info for ${buildName}`, text);
    }
  }

  await copyAssets("client_bundle/client/.client");
  await patchServiceWorker();

  console.log("Built!");
}

async function copyAssets(dist: string) {
  await mkdir(dist, { recursive: true });
  await cp("client/fonts", dist, { recursive: true });
  await cp("client/html", dist, { recursive: true });
  await cp("client/images/favicon-96x96.png", `${dist}/favicon-96x96.png`);
  await cp("client/images/favicon.svg", `${dist}/favicon.svg`);
  await cp("client/images/favicon.ico", `${dist}/favicon.ico`);
  await cp(
    "client/images/apple-touch-icon.png",
    `${dist}/apple-touch-icon.png`,
  );
  await cp("client/images/logo.png", `${dist}/logo.png`);
  await cp("client/images/logo-dock.png", `${dist}/logo-dock.png`);
  // Small copy of the dock icon for inline UI use (the Space Manager's
  // wordmark). Generated from logo-dock.png — see that file's note in
  // client/images/README.md. The 1024px original is 405 KB for something
  // drawn at ~26 CSS px.
  await cp("client/images/logo-dock-96x96.png", `${dist}/logo-dock-96x96.png`);

  // Three stylesheets, all compiled from the same partials so they cannot
  // drift: main.css for the editor, app.css for the standalone pages (login,
  // setup wizard, Space Manager) and components.css for plug panel iframes —
  // the last kept under that name because `panelStyles()` and the plug docs
  // reference it.
  for (const [entry, output] of [
    ["main.scss", "main.css"],
    ["app.scss", "app.css"],
    ["components_bundle.scss", "components.css"],
  ]) {
    const scss = await readFile(`client/styles/${entry}`, "utf-8");
    const compiled = sass.compileString(scss, {
      loadPaths: ["client/styles"],
      style: "compressed",
    });
    await writeFile(`${dist}/${output}`, compiled.css, "utf-8");
  }

  // HACK: Patch the JS by removing an invalid regex
  let bundleJs = await readFile(`${dist}/client.js`, "utf-8");
  bundleJs = patchBundledJS(bundleJs);
  await writeFile(`${dist}/client.js`, bundleJs, "utf-8");
}

// Shells and bundles for the server-level surfaces (Space Manager at /.spaces,
// the setup wizard at /.setup) and the per-space login page. None of these are
// part of the offline app shell: they are entry points the service worker must
// never answer from cache. Add an entry here when adding a bundle entry point.
const NOT_PRECACHED = new Set([
  "auth.html",
  "auth.js",
  "index.html",
  "spaces.html",
  "spaces.js",
  "setup.html",
  "setup.js",
  "app.css",
  "LICENSE.md",
]);

async function patchServiceWorker() {
  // Scan .client/ directory to build the full precache file list
  const clientDir = "client_bundle/client/.client";
  const allFiles = await readdir(clientDir);
  const precacheFiles = [
    "/", // The index page
    "/.client/manifest.json", // Dynamically generated by the server, but needed for PWA
    ...allFiles
      .filter((f) => !f.endsWith(".map") && !NOT_PRECACHED.has(f))
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
  await buildClient();
  await esbuild.stop();
}
