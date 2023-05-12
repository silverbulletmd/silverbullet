import { HttpSpacePrimitives } from "../../common/spaces/http_space_primitives.ts";
import { SysCallMapping } from "../../plugos/system.ts";

export function shellSyscalls(
  httpSpacePrimitives?: HttpSpacePrimitives,
): SysCallMapping {
  return {
    "shell.run": async (
      _ctx,
      cmd: string,
      args: string[],
    ): Promise<{ stdout: string; stderr: string; code: number }> => {
      if (!httpSpacePrimitives) {
        throw new Error("Not supported in fully local mode");
      }
      const resp = httpSpacePrimitives.authenticatedFetch(
        httpSpacePrimitives.url,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "shell",
            cmd,
            args,
          }),
        },
      );
      const { code, stderr, stdout } = await (await resp).json();
      if (code !== 0) {
        throw new Error(stderr);
      }
      return { code, stderr, stdout };
    },
  };
}
