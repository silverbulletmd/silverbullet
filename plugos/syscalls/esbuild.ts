import { sandboxCompile, sandboxCompileModule } from "../compile.ts";
import { SysCallMapping } from "../system.ts";

// TODO: FIgure out a better way to do this
const builtinModules = ["yaml", "handlebars"];

export function esbuildSyscalls(): SysCallMapping {
  return {
    "esbuild.compile": async (
      _ctx,
      filename: string,
      code: string,
      functionName?: string,
      excludeModules: string[] = [],
    ): Promise<string> => {
      return await sandboxCompile(
        filename,
        code,
        functionName,
        true,
        [...builtinModules, ...excludeModules],
      );
    },
    "esbuild.compileModule": async (
      _ctx,
      moduleName: string,
    ): Promise<string> => {
      return await sandboxCompileModule(moduleName, builtinModules);
    },
  };
}
