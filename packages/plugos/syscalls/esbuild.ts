import { sandboxCompile, sandboxCompileModule } from "../compile";
import { SysCallMapping } from "../system";

import globalModules from "../../common/dist/global.plug.json";

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
      functionName?: string,
      excludeModules: string[] = []
    ): Promise<string> => {
      return await sandboxCompile(
        filename,
        code,
        functionName,
        true,
        [],
        [...Object.keys(globalModules.dependencies), ...excludeModules]
      );
    },
    "esbuild.compileModule": async (
      ctx,
      moduleName: string
    ): Promise<string> => {
      return await sandboxCompileModule(
        moduleName,
        Object.keys(globalModules.dependencies)
      );
    },
  };
}
