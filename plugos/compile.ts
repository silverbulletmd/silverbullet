// import { esbuild } from "../../mod.ts";
import * as esbuildWasm from "https://deno.land/x/esbuild@v0.14.54/wasm.js";
import * as esbuildNative from "https://deno.land/x/esbuild@v0.14.54/mod.js";

export const esbuild: typeof esbuildWasm = Deno.run === undefined
  ? esbuildWasm
  : esbuildNative;

import { path } from "../server/deps.ts";
import { denoPlugin } from "../esbuild_deno_loader/mod.ts";
import { patchDenoLibJS } from "../common/hack.ts";

export type CompileOptions = {
  debug?: boolean;
  excludeModules?: string[];
  meta?: boolean;
  importMap?: URL;
};

export async function compile(
  filePath: string,
  functionName: string | undefined = undefined,
  options: CompileOptions = {},
): Promise<string> {
  const outFile = await Deno.makeTempFile({ suffix: ".js" });
  let inFile = filePath;

  if (functionName) {
    // Generate a new file importing just this one function and exporting it
    inFile = await Deno.makeTempFile({ suffix: ".ts" });
    await Deno.writeTextFile(
      inFile,
      `import {${functionName}} from "${
        path.resolve(filePath)
      }";export default ${functionName};`,
    );
  }

  // console.log("External modules", excludeModules);

  try {
    // TODO: Figure out how to make source maps work correctly with eval() code
    const result = await esbuild.build({
      entryPoints: [path.basename(inFile)],
      bundle: true,
      format: "iife",
      globalName: "mod",
      platform: "browser",
      sourcemap: false, //debug ? "inline" : false,
      minify: !options.debug,
      outfile: outFile,
      metafile: true,
      external: options.excludeModules || [],
      treeShaking: true,
      plugins: [
        denoPlugin({
          importMapURL: options.importMap ||
            new URL("./../import_map.json", import.meta.url),
        }),
      ],
      loader: {
        ".css": "text",
        ".md": "text",
        ".txt": "text",
        ".html": "text",
        ".hbs": "text",
        ".png": "dataurl",
        ".gif": "dataurl",
        ".jpg": "dataurl",
      },
      absWorkingDir: path.resolve(path.dirname(inFile)),
    });

    if (options.meta) {
      const text = await esbuild.analyzeMetafile(result.metafile);
      console.log("Bundle info for", functionName, text);
    }

    let jsCode = await Deno.readTextFile(outFile);
    jsCode = patchDenoLibJS(jsCode);
    await Deno.remove(outFile);
    return `(() => { ${jsCode} return mod;})()`;
  } finally {
    if (inFile !== filePath) {
      await Deno.remove(inFile);
    }
  }
}

export async function compileModule(
  cwd: string,
  moduleName: string,
  options: CompileOptions = {},
): Promise<string> {
  const inFile = path.resolve(cwd, "_in.ts");
  await Deno.writeTextFile(inFile, `export * from "${moduleName}";`);
  const code = await compile(inFile, undefined, options);
  await Deno.remove(inFile);
  return code;
}

export async function sandboxCompile(
  filename: string,
  code: string,
  functionName?: string,
  options: CompileOptions = {},
): Promise<string> {
  const tmpDir = await Deno.makeTempDir();

  await Deno.writeTextFile(`${tmpDir}/${filename}`, code);
  const jsCode = await compile(
    `${tmpDir}/${filename}`,
    functionName,
    options,
  );
  await Deno.remove(tmpDir, { recursive: true });
  return jsCode;
}

export async function sandboxCompileModule(
  moduleUrl: string,
  options: CompileOptions = {},
): Promise<string> {
  await Deno.writeTextFile(
    "_mod.ts",
    `module.exports = require("${moduleUrl}");`,
  );
  const code = await compile("_mod.ts", undefined, options);
  await Deno.remove("_mod.ts");
  return code;
}
