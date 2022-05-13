import { compile } from "../compile";
import { SysCallMapping } from "../system";
import { tmpdir } from "os";
import { mkdir, rm, symlink, writeFile } from "fs/promises";
import { nodeModulesDir } from "../environments/node_sandbox";

const exposedModules = [
  "@silverbulletmd/plugos-silverbullet-syscall",
  "@plugos/plugos-syscall",
  "yaml",
];

import * as ts from "typescript";

type CompileError = {
  message: string;
  pos: number;
};

function checkTypeScript(scriptFile: string): void {
  let program = ts.createProgram([scriptFile], {
    noEmit: true,
    allowJs: true,
  });
  let emitResult = program.emit();

  let allDiagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emitResult.diagnostics);

  let errors: CompileError[] = [];
  allDiagnostics.forEach((diagnostic) => {
    if (diagnostic.file) {
      let { line, character } = ts.getLineAndCharacterOfPosition(
        diagnostic.file,
        diagnostic.start!
      );
      let message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n"
      );
      errors.push({
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        pos: diagnostic.start!,
      });
      // console.log(
      //   `${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`
      // );
    } else {
      console.log(
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
      );
    }
  });

  let exitCode = emitResult.emitSkipped ? 1 : 0;
  console.log(`Process exiting with code '${exitCode}'.`);
  process.exit(exitCode);
}

export function esbuildSyscalls(): SysCallMapping {
  return {
    "tsc.analyze": async (
      ctx,
      filename: string,
      code: string
    ): Promise<any> => {},
    "esbuild.compile": async (
      ctx,
      filename: string,
      code: string,
      functionName?: string
    ): Promise<string> => {
      let tmpDir = await prepareCompileEnv(filename, code);
      let jsCode = await compile(`${tmpDir}/${filename}`, functionName, false, [
        "yaml",
        "handlebars",
      ]);
      await rm(tmpDir, { recursive: true });
      return jsCode;
    },
  };
}

async function prepareCompileEnv(filename: string, code: string) {
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

  await writeFile(`${tmpDir}/${filename}`, code);
  return tmpDir;
}
