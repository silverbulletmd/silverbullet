import esbuild from "esbuild";
import { readFile, unlink, writeFile } from "fs/promises";
import path from "path";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { Manifest } from "../../webapp/src/plugins/types";

async function compile(filePath: string, sourceMap: boolean) {
  let tempFile = "out.js";
  let js = await esbuild.build({
    entryPoints: [filePath],
    bundle: true,
    format: "iife",
    globalName: "mod",
    platform: "neutral",
    sourcemap: sourceMap ? "inline" : false,
    minify: true,
    outfile: tempFile,
  });

  let jsCode = (await readFile(tempFile)).toString();
  jsCode = jsCode.replace(/^var mod ?= ?/, "");
  await unlink(tempFile);
  return jsCode;
}

async function bundle(manifestPath: string, sourceMaps: boolean) {
  const rootPath = path.dirname(manifestPath);
  const manifest = JSON.parse(
    (await readFile(manifestPath)).toString()
  ) as Manifest;

  for (let [name, def] of Object.entries(manifest.functions)) {
    let jsFunctionName = def.functionName,
      filePath = path.join(rootPath, def.path);
    if (filePath.indexOf(":") !== -1) {
      [filePath, jsFunctionName] = filePath.split(":");
    } else if (!jsFunctionName) {
      jsFunctionName = "default";
    }

    def.code = await compile(filePath, sourceMaps);
    def.path = filePath;
    def.functionName = jsFunctionName;
  }
  return manifest;
}
async function run() {
  let args = await yargs(hideBin(process.argv))
    .option("debug", {
      type: "boolean",
    })
    .parse();

  let generatedManifest = await bundle(args._[0] as string, !!args.debug);
  writeFile(args._[1] as string, JSON.stringify(generatedManifest, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
