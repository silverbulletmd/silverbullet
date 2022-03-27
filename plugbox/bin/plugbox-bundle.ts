#!/usr/bin/env node

import esbuild from "esbuild";
import { readFile, unlink, writeFile } from "fs/promises";
import path from "path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { Manifest } from "../types";
import { watchFile } from "fs";
import YAML from "yaml";

async function compile(filePath: string, functionName: string, debug: boolean) {
  let outFile = "out.js";

  let inFile = filePath;

  if (functionName) {
    // Generate a new file importing just this one function and exporting it
    inFile = "in.js";
    await writeFile(
      inFile,
      `import {${functionName}} from "./${filePath}";
export default ${functionName};`
    );
  }

  // TODO: Figure out how to make source maps work correctly with eval() code
  let js = await esbuild.build({
    entryPoints: [inFile],
    bundle: true,
    format: "iife",
    globalName: "mod",
    platform: "neutral",
    sourcemap: false, //sourceMap ? "inline" : false,
    minify: !debug,
    outfile: outFile,
  });

  let jsCode = (await readFile(outFile)).toString();
  jsCode = jsCode.replace(/^var mod ?= ?/, "");
  await unlink(outFile);
  if (inFile !== filePath) {
    await unlink(inFile);
  }
  // Strip final ';'
  return jsCode.substring(0, jsCode.length - 2);
}

async function bundle(manifestPath: string, sourceMaps: boolean) {
  const rootPath = path.dirname(manifestPath);
  const manifest = YAML.parse(
    (await readFile(manifestPath)).toString()
  ) as Manifest<any>;

  for (let [name, def] of Object.entries(manifest.functions)) {
    let jsFunctionName = "default",
      filePath = path.join(rootPath, def.path!);
    if (filePath.indexOf(":") !== -1) {
      [filePath, jsFunctionName] = filePath.split(":");
    }

    def.code = await compile(filePath, jsFunctionName, sourceMaps);
    delete def.path;
  }
  return manifest;
}

async function buildManifest(
  manifestPath: string,
  distPath: string,
  debug: boolean
) {
  let generatedManifest = await bundle(manifestPath, debug);
  const outFile =
    manifestPath.substring(
      0,
      manifestPath.length - path.extname(manifestPath).length
    ) + ".json";
  const outPath = path.join(distPath, path.basename(outFile));
  console.log("Emitting bundle to", outPath);
  await writeFile(outPath, JSON.stringify(generatedManifest, null, 2));
  return { generatedManifest, outPath };
}

async function run() {
  let args = yargs(hideBin(process.argv))
    .option("debug", {
      type: "boolean",
    })
    .option("watch", {
      type: "boolean",
      alias: "w",
    })
    .option("dist", {
      type: "string",
      default: ".",
    })
    .parse();
  if (args._.length === 0) {
    console.log(
      "Usage: plugbox-bundle [--debug] [--dist <path>] <manifest.plug.yaml> <manifest2.plug.yaml> ..."
    );
    process.exit(1);
  }
  for (const plugManifestPath of args._) {
    let manifestPath = plugManifestPath as string;
    await buildManifest(manifestPath, args.dist, !!args.debug);
    if (args.watch) {
      watchFile(manifestPath, { interval: 1000 }, async () => {
        console.log("Rebuilding", manifestPath);
        await buildManifest(manifestPath, args.dist, !!args.debug);
      });
    }
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
