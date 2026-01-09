import { copy } from "@std/fs";
import { dirname } from "@std/path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import sass from "denosass";

import { patchDenoLibJS } from "./client/plugos/plug_compile.ts";
import { denoPlugins } from "@luca/esbuild-deno-loader";
import * as esbuild from "esbuild";

// This builds the client and puts it into client_bundle/client

export async function bundleAll(): Promise<void> {
  await buildCopyBundleAssets();
}

export async function copyAssets(dist: string) {
  await Deno.mkdir(dist, { recursive: true });
  await copy("client/fonts", `${dist}`, { overwrite: true });
  await copy("client/html/index.html", `${dist}/index.html`, {
    overwrite: true,
  });
  await copy("client/html/auth.html", `${dist}/auth.html`, {
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

  let katexCss = "";
  try {
    const require = createRequire(import.meta.url);
    const katexCssPath = require.resolve("katex/dist/katex.min.css");
    const katexPath = dirname(katexCssPath);

    // Copy Katex fonts
    await Deno.mkdir(`${dist}/fonts`, { recursive: true });
    // Copy only woff2 fonts
    for await (const entry of Deno.readDir(`${katexPath}/fonts`)) {
      if (entry.isFile && entry.name.endsWith(".woff2")) {
        await copy(
          `${katexPath}/fonts/${entry.name}`,
          `${dist}/fonts/${entry.name}`,
          { overwrite: true },
        );
      }
    }
    // Read KaTex css
    katexCss = Deno.readTextFileSync(katexCssPath);
  } catch (e: any) {
    console.warn(
      `Could not find KaTeX in node_modules, skipping copy: ${e.message}`,
    );
  }

  // Remove font fallbacks for woff and ttf
  katexCss = katexCss.replaceAll(
    /,\s*url\(fonts\/[^)]+\.(woff|ttf)\)\s*format\(['"]?(woff|truetype)['"]?\)/g,
    "",
  );

  const compiler = sass(
    Deno.readTextFileSync("client/styles/main.scss"),
    {
      load_paths: ["client/styles"],
    },
  );
  await Deno.writeTextFile(
    `${dist}/main.css`,
    katexCss + "\n" + compiler.to_string("expanded") as string,
  );

  // HACK: Patch the JS by removing an invalid regex
  let bundleJs = await Deno.readTextFile(`${dist}/client.js`);
  bundleJs = patchDenoLibJS(bundleJs);
  await Deno.writeTextFile(`${dist}/client.js`, bundleJs);
}

async function buildCopyBundleAssets() {
  await Deno.mkdir("client_bundle/client", { recursive: true });
  await Deno.mkdir("client_bundle/base_fs", { recursive: true });

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
    absWorkingDir: Deno.cwd(),
    bundle: true,
    treeShaking: true,
    sourcemap: "linked",
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
  let swCode = await Deno.readTextFile(
    "client_bundle/client/service_worker.js",
  );
  swCode = swCode.replaceAll("{{CACHE_NAME}}", `cache-${Date.now()}`);
  await Deno.writeTextFile("client_bundle/client/service_worker.js", swCode);

  await copyAssets("client_bundle/client/.client");

  console.log("Built!");
}

if (import.meta.main) {
  await bundleAll();
  esbuild.stop();
}
