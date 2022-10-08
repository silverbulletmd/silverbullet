// import { esbuild } from "../../mod.ts";
import * as esbuildWasm from "https://deno.land/x/esbuild@v0.14.54/wasm.js";
import * as esbuildNative from "https://deno.land/x/esbuild@v0.14.54/mod.js";

export const esbuild: typeof esbuildWasm = Deno.run === undefined
  ? esbuildWasm
  : esbuildNative;

import { path } from "../dep_server.ts";
import { denoPlugin } from "../esbuild_deno_loader/mod.ts";
import { patchDenoLibJS } from "../common/hack.ts";

export async function compile(
  filePath: string,
  functionName: string | undefined = undefined,
  debug = false,
  excludeModules: string[] = [],
  meta = false,
): Promise<string> {
  let outFile = path.resolve(path.dirname(filePath), "_out.tmp");
  let inFile = filePath;

  if (functionName) {
    // Generate a new file importing just this one function and exporting it
    inFile = path.resolve(path.dirname(filePath), "_in.ts");
    await Deno.writeTextFile(
      inFile,
      `import {${functionName}} from "./${
        path.basename(
          filePath,
        )
      }";export default ${functionName};`,
    );
  }

  // console.log("External modules", excludeModules);

  try {
    // TODO: Figure out how to make source maps work correctly with eval() code
    let result = await esbuild.build({
      entryPoints: [path.basename(inFile)],
      bundle: true,
      format: "iife",
      globalName: "mod",
      platform: "browser",
      sourcemap: false, //debug ? "inline" : false,
      minify: !debug,
      outfile: outFile,
      metafile: true,
      external: excludeModules,
      treeShaking: true,
      plugins: [
        denoPlugin({
          importMapURL: new URL("./../import_map.json", import.meta.url),
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

    if (meta) {
      let text = await esbuild.analyzeMetafile(result.metafile);
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
): Promise<string> {
  let inFile = path.resolve(cwd, "_in.ts");
  await Deno.writeTextFile(inFile, `export * from "${moduleName}";`);
  let code = await compile(inFile);
  await Deno.remove(inFile);
  return code;
}

// export async function sandboxCompile(
//   filename: string,
//   code: string,
//   functionName?: string,
//   debug: boolean = false,
//   installModules: string[] = [],
//   globalModules: string[] = []
// ): Promise<string> {
//   let tmpDir = `${tmpdir()}/plugos-${Math.random()}`;
//   await mkdir(tmpDir, { recursive: true });

//   const srcNodeModules = `${nodeModulesDir}/node_modules`;
//   const targetNodeModules = `${tmpDir}/node_modules`;

//   await mkdir(`${targetNodeModules}/@silverbulletmd`, { recursive: true });
//   await mkdir(`${targetNodeModules}/@plugos`, { recursive: true });
//   for (const exposedModule of exposedModules) {
//     await symlink(
//       `${srcNodeModules}/${exposedModule}`,
//       `${targetNodeModules}/${exposedModule}`,
//       "dir"
//     );
//   }
//   for (let moduleName of installModules) {
//     await execFilePromise("npm", ["install", moduleName], {
//       cwd: tmpDir,
//     });
//   }

//   await writeFile(`${tmpDir}/${filename}`, code);
//   let jsCode = await compile(
//     `${tmpDir}/${filename}`,
//     functionName,
//     debug,
//     globalModules
//   );
//   await rm(tmpDir, { recursive: true });
//   return jsCode;
// }

export async function sandboxCompileModule(
  moduleUrl: string,
  globalModules: string[] = [],
): Promise<string> {
  await Deno.writeTextFile(
    "_mod.ts",
    `module.exports = require("${moduleUrl}");`,
  );
  let code = await compile("_mod.ts", undefined, false, globalModules);
  await Deno.remove("_mod.ts");
  return code;
}
