import { parse } from "https://deno.land/std@0.121.0/flags/mod.ts";

import * as path from "https://deno.land/std@0.121.0/path/mod.ts";
import { Manifest, FunctionDef } from "../webapp/src/plugins/types.ts";

async function compile(filePath: string, sourceMaps: boolean): Promise<string> {
  // @ts-ignore for Deno.emit (unstable API)
  let { files, diagnostics } = await Deno.emit(filePath, {
    bundle: "classic",
    check: true,
    compilerOptions: {
      lib: ["WebWorker", "ES2020"],
      inlineSourceMap: sourceMaps,
      sourceMap: false,
    },
  });
  let bundleSource = files["deno:///bundle.js"];

  if (diagnostics.length > 0) {
    for (let diagnostic of diagnostics) {
      if (diagnostic.start) {
        console.error(
          `In ${diagnostic.fileName}:${diagnostic.start!.line + 1}: ${
            diagnostic.messageText
          }`
        );
      } else {
        console.error(diagnostic);
      }
    }
    throw new Error("Diagnostics");
  }
  return bundleSource;
}

async function bundle(
  manifestPath: string,
  sourceMaps: boolean
): Promise<Manifest> {
  const rootPath = path.dirname(manifestPath);
  const manifest = JSON.parse(
    new TextDecoder().decode(await Deno.readFile(manifestPath))
  ) as Manifest;

  for (let [name, def] of Object.entries(manifest.functions) as Array<
    [string, FunctionDef]
  >) {
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

let commandLineArguments = parse(Deno.args, {
  boolean: true,
});

let [manifestPath, outputPath] = commandLineArguments._ as string[];
console.log(`Generating bundle for ${manifestPath} to ${outputPath}`);
let b = await bundle(manifestPath, !!commandLineArguments.debug);
await Deno.writeFile(
  outputPath,
  new TextEncoder().encode(JSON.stringify(b, null, 2))
);
