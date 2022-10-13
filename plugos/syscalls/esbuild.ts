import { sandboxCompile, sandboxCompileModule } from "../compile.ts";
import { SysCallMapping } from "../system.ts";
import { Manifest } from "../types.ts";

export function esbuildSyscalls(
  imports: Manifest<any>[],
): SysCallMapping {
  return {
    "esbuild.compile": async (
      _ctx,
      filename: string,
      code: string,
      functionName?: string,
    ): Promise<string> => {
      return await sandboxCompile(
        filename,
        code,
        functionName,
        {
          debug: true,
          imports,
        },
      );
    },
    "esbuild.compileModule": async (
      _ctx,
      moduleName: string,
    ): Promise<string> => {
      return await sandboxCompileModule(moduleName, {
        imports,
      });
    },
  };
}
