import { parse } from "https://deno.land/std@0.121.0/flags/mod.ts";

// import { mime } from "https://deno.land/x/mimetypes@v1.0.0/mod.ts";
//
// async function dataEncodeUint8Array(path : string, data: Uint8Array): Promise<string> {
//     const base64url: string = await new Promise((r) => {
//         const reader = new FileReader();
//         reader.onload = () => r(reader.result as string);
//         reader.readAsDataURL(new Blob([data]))
//     })
//     let [meta, content] = base64url.split(';');
//     let [prefix, mimeType] = meta.split(':');
//     return `data:${mime.getType(path)};${content}`;
// }
import * as path from "https://deno.land/std@0.121.0/path/mod.ts";
import { Manifest, FunctionDef } from "../webapp/src/plugins/types.ts";

async function compile(
  filePath: string,
  prettyFunctionName: string,
  jsFunctionName: string,
  sourceMaps: boolean
): Promise<string> {
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
  return `const mod = ${bundleSource}

self.addEventListener('invoke-function', async e => {
    try {
        let result = await mod['${jsFunctionName}'](...e.detail.args);
        self.dispatchEvent(new CustomEvent('result', {detail: result}));
    } catch(e) {
        console.error(\`Error while running ${jsFunctionName}\`, e);
        self.dispatchEvent(new CustomEvent('app-error', {detail: e.message}));
    }
});
`;
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
    let jsFunctionName,
      filePath = path.join(rootPath, def.path);
    if (filePath.indexOf(":") !== 0) {
      [filePath, jsFunctionName] = filePath.split(":");
    } else {
      jsFunctionName = "default";
    }

    def.code = await compile(filePath, name, jsFunctionName, sourceMaps);
  }
  return manifest;
  // let files: { [key: string]: string } = {};
  // for await (const entry of walk(path, {includeDirs: false})) {
  //     let content = await Deno.readFile(entry.path);
  //     files[entry.path.substring(path.length + 1)] = await dataEncodeUint8Array(entry.path, content);
  // }
  // return files;
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
/*
const watcher = Deno.watchFs("test_app");

for await (const event of watcher) {
    console.log("Updating bundle...");
    let b = await bundle("test_app/test.cartridge.json");
    await Deno.writeFile("test_app.bundle.json", new TextEncoder().encode(JSON.stringify(b, null, 2)));
}

 */
