// The recommended way to use this for now is through `silverbullet bundle:build` until
// we fork out PlugOS as a whole

import { Manifest } from "../types.ts";
import { YAML } from "../../common/deps.ts";
import { CompileOptions, esbuild } from "../compile.ts";
import { flags, path } from "../deps.ts";

import { bundleAssets } from "../asset_bundle/builder.ts";
import { denoPlugin } from "../forked/esbuild_deno_loader/mod.ts";
import { patchDenoLibJS } from "../hack.ts";

export async function compileManifest(
  manifestPath: string,
  destPath: string,
  options: CompileOptions = {},
) {
  const rootPath = path.dirname(manifestPath);
  const manifest = YAML.parse(
    await Deno.readTextFile(manifestPath),
  ) as Manifest<any>;

  if (!manifest.name) {
    throw new Error(`Missing 'name' in ${manifestPath}`);
  }

  // Assets
  const assetsBundle = await bundleAssets(
    path.resolve(rootPath),
    manifest.assets as string[] || [],
  );
  manifest.assets = assetsBundle.toJSON();

  const jsFile = `
import {setupMessageListener} from "${new URL(
    "./../environments/sandbox_worker.ts",
    import.meta.url,
  )}";

// Imports
${
    Object.entries(manifest.functions).map(([funcName, def]) => {
      if (!def.path) {
        return "";
      }
      let [filePath, jsFunctionName] = def.path.split(":");
      // Resolve path
      filePath = path.join(rootPath, filePath);

      return `import {${jsFunctionName} as ${funcName}} from "file://${
        // Replacaing \ with / for Windows
        path.resolve(filePath).replaceAll(
          "\\",
          "\\\\",
        )}";\n`;
    }).join("")
  }

// Function mapping
export const functionMapping = {
${
    Object.entries(manifest.functions).map(([funcName, def]) => {
      if (!def.path) {
        return "";
      }
      return `  ${funcName}: ${funcName},\n`;
    }).join("")
  }
};

const manifest = ${JSON.stringify(manifest, null, 2)};

setupMessageListener(functionMapping, manifest);
`;

  // console.log("Code:", jsFile);

  const inFile = await Deno.makeTempFile({ suffix: ".js" });
  const outFile = `${destPath}/${manifest.name}.plug.js`;
  await Deno.writeTextFile(inFile, jsFile);

  const result = await esbuild.build({
    entryPoints: [path.basename(inFile)],
    bundle: true,
    format: "iife",
    globalName: "mod",
    platform: "browser",
    sourcemap: options.debug ? "inline" : false,
    minify: !options.debug,
    outfile: outFile,
    metafile: options.info,
    // external: esBuildExternals(options.imports),
    treeShaking: true,
    plugins: [
      denoPlugin({
        // TODO do this differently
        importMapURL: options.importMap ||
          new URL("./../../import_map.json", import.meta.url),
        loader: "native",
      }),
    ],
    absWorkingDir: path.resolve(path.dirname(inFile)),
  });

  if (options.info) {
    const text = await esbuild.analyzeMetafile(result.metafile!);
    console.log("Bundle info for", manifestPath, text);
  }

  let jsCode = await Deno.readTextFile(outFile);
  jsCode = patchDenoLibJS(jsCode);
  await Deno.writeTextFile(outFile, jsCode);
  console.log(`Plug ${manifest.name} written to ${outFile}.`);
}

export async function bundleRun(
  manifestFiles: string[],
  dist: string,
  watch: boolean,
  options: CompileOptions = {},
) {
  let building = false;
  dist = path.resolve(dist);
  async function buildAll() {
    if (building) {
      return;
    }
    console.log("Building", manifestFiles);
    building = true;
    Deno.mkdirSync(dist, { recursive: true });
    const startTime = Date.now();
    // Build all plugs in parallel
    await Promise.all(manifestFiles.map(async (plugManifestPath) => {
      const manifestPath = plugManifestPath as string;
      try {
        await compileManifest(
          manifestPath,
          dist,
          options,
        );
      } catch (e) {
        console.error(`Error building ${manifestPath}:`, e);
      }
    }));
    console.log(`Done building plugs in ${Date.now() - startTime}ms`);
    building = false;
  }

  await buildAll();

  if (watch) {
    console.log("Watching for changes...");
    const watcher = Deno.watchFs(manifestFiles.map((p) => path.dirname(p)));
    for await (const event of watcher) {
      if (event.paths.length > 0) {
        if (event.paths[0].endsWith(".json")) {
          continue;
        }
      }
      console.log("Change detected, rebuilding...");
      buildAll();
    }
  }
}

if (import.meta.main) {
  const args = flags.parse(Deno.args, {
    boolean: ["debug", "watch", "reload", "info"],
    string: ["dist", "importmap"],
    alias: { w: "watch" },
  });

  if (args._.length === 0) {
    console.log(
      "Usage: plugos-bundle [--debug] [--reload] [--dist <path>] [--info] [--importmap import_map.json] [--exclude=package1,package2] <manifest.plug.yaml> <manifest2.plug.yaml> ...",
    );
    Deno.exit(1);
  }

  if (!args.dist) {
    args.dist = path.resolve(".");
  }

  await bundleRun(
    args._ as string[],
    args.dist,
    args.watch,
    {
      debug: args.debug,
      reload: args.reload,
      info: args.info,
      importMap: args.importmap
        ? new URL(args.importmap, `file://${Deno.cwd()}/`)
        : undefined,
    },
  );
  esbuild.stop();
}
