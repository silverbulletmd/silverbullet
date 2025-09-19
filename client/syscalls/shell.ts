import type { SysCallMapping } from "../../lib/plugos/system.ts";
import type { Client } from "../client.ts";
import { fsEndpoint } from "../../lib/spaces/constants.ts";

export function shellSyscalls(
  client: Client,
): SysCallMapping {
  return {
    "shell.run": async (
      _ctx,
      cmd: string,
      args: string[],
      stdin?: string,
    ): Promise<{ stdout: string; stderr: string; code: number }> => {
      if (!client.httpSpacePrimitives) {
        throw new Error("Not supported in fully local mode");
      }
      const resp = client.httpSpacePrimitives.authenticatedFetch(
        buildShellUrl(client),
        {
          method: "POST",
          body: JSON.stringify({
            cmd,
            args,
            stdin,
          }),
        },
      );
      const { code, stderr, stdout } = await (await resp).json();
      return { code, stderr, stdout };
    },
  };
}

function buildShellUrl(client: Client) {
  // Strip off the /.fs and replace with /.shell
  return client.httpSpacePrimitives.url.slice(0, -fsEndpoint.length) +
    "/.shell";
}
