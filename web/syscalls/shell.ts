import { SysCallMapping } from "../../lib/plugos/system.ts";
import type { Client } from "../client.ts";

export function shellSyscalls(
  client: Client,
): SysCallMapping {
  return {
    "shell.run": async (
      _ctx,
      cmd: string,
      args: string[],
    ): Promise<{ stdout: string; stderr: string; code: number }> => {
      if (!client.httpSpacePrimitives) {
        throw new Error("Not supported in fully local mode");
      }
      const resp = client.httpSpacePrimitives.authenticatedFetch(
        `${client.httpSpacePrimitives.url}/.rpc/shell`,
        {
          method: "POST",
          body: JSON.stringify({
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
