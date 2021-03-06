import { sandboxCompile, sandboxCompileModule } from "../compile";
import { SysCallMapping } from "../system";

// TODO: FIgure out a better way to do this
const builtinModules = ["yaml", "handlebars"];

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
        [...builtinModules, ...excludeModules]
      );
    },
    "esbuild.compileModule": async (
      ctx,
      moduleName: string
    ): Promise<string> => {
      return await sandboxCompileModule(moduleName, builtinModules);
    },
  };
}
