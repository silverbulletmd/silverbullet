import esbuild from "esbuild";
import { mkdir, readFile, rm, symlink, unlink, writeFile } from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import { nodeModulesDir } from "./environments/node_sandbox";
import { promisify } from "util";
import { execFile } from "child_process";
const execFilePromise = promisify(execFile);

export async function compile(
  filePath: string,
  functionName: string | undefined = undefined,
  debug: boolean = false,
  excludeModules: string[] = [],
  meta = false
): Promise<string> {
  let outFile = path.resolve(path.dirname(filePath), "_out.tmp");
  let inFile = filePath;

  if (functionName) {
    // Generate a new file importing just this one function and exporting it
    inFile = path.resolve(path.dirname(filePath), "_in.ts");
    await writeFile(
      inFile,
      `import {${functionName}} from "./${path.basename(
        filePath
      )}";export default ${functionName};`
    );
  }

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
    absWorkingDir: path.resolve(path.dirname(inFile)),
  });

  if (meta) {
    let text = await esbuild.analyzeMetafile(result.metafile);
    // console.log("Bundle info for", functionName, text);
  }

  let jsCode = (await readFile(outFile)).toString();
  await unlink(outFile);
  if (inFile !== filePath) {
    await unlink(inFile);
  }
  return `(() => { ${jsCode} return mod;})()`;
}

export async function compileModule(
  cwd: string,
  moduleName: string
): Promise<string> {
  let inFile = path.resolve(cwd, "_in.ts");
  await writeFile(inFile, `export * from "${moduleName}";`);
  let code = await compile(inFile);
  await unlink(inFile);
  return code;
}

// TODO: Reconsider this later
const exposedModules = [
  "@silverbulletmd/plugos-silverbullet-syscall",
  "@plugos/plugos-syscall",
];

export async function sandboxCompile(
  filename: string,
  code: string,
  functionName?: string,
  debug: boolean = false,
  installModules: string[] = [],
  globalModules: string[] = []
): Promise<string> {
  let tmpDir = `${tmpdir()}/plugos-${Math.random()}`;
  await mkdir(tmpDir, { recursive: true });

  const srcNodeModules = `${nodeModulesDir}/node_modules`;
  const targetNodeModules = `${tmpDir}/node_modules`;

  await mkdir(`${targetNodeModules}/@silverbulletmd`, { recursive: true });
  await mkdir(`${targetNodeModules}/@plugos`, { recursive: true });
  for (const exposedModule of exposedModules) {
    await symlink(
      `${srcNodeModules}/${exposedModule}`,
      `${targetNodeModules}/${exposedModule}`,
      "dir"
    );
  }
  for (let moduleName of installModules) {
    await execFilePromise("npm", ["install", moduleName], {
      cwd: tmpDir,
    });
  }

  await writeFile(`${tmpDir}/${filename}`, code);
  let jsCode = await compile(
    `${tmpDir}/${filename}`,
    functionName,
    debug,
    globalModules
  );
  await rm(tmpDir, { recursive: true });
  return jsCode;
}

export async function sandboxCompileModule(
  moduleName: string,
  globalModules: string[] = []
): Promise<string> {
  let [modulePart, path] = moduleName.split(":");
  let modulePieces = modulePart.split("@");
  let cleanModulesName = modulePieces
    .slice(0, modulePieces.length - 1)
    .join("@");
  return sandboxCompile(
    "module.ts",
    // `export * from "${cleanModulesName}${path ? path : ""}";`,
    `module.exports = require("${cleanModulesName}${path ? path : ""}");`,
    undefined,
    true,
    [modulePart],
    globalModules
  );
}
