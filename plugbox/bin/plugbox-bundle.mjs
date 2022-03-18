#!/usr/bin/env node

import esbuild from "esbuild";
import { readFile, unlink, writeFile } from "fs/promises";
import path from "path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

async function compile(filePath, functionName, debug) {
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

async function bundle(manifestPath, sourceMaps) {
  const rootPath = path.dirname(manifestPath);
  const manifest = JSON.parse((await readFile(manifestPath)).toString());

  for (let [name, def] of Object.entries(manifest.functions)) {
    let jsFunctionName = def.functionName,
      filePath = path.join(rootPath, def.path);
    if (filePath.indexOf(":") !== -1) {
      [filePath, jsFunctionName] = filePath.split(":");
    }

    def.code = await compile(filePath, jsFunctionName, sourceMaps);
    delete def.path;
  }
  return manifest;
}
async function run() {
  let args = await yargs(hideBin(process.argv))
    .option("debug", {
      type: "boolean",
    })
    .parse();

  let generatedManifest = await bundle(args._[0], !!args.debug);
  await writeFile(args._[1], JSON.stringify(generatedManifest, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
