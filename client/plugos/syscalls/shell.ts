import type { SysCallMapping } from "../system.ts";
import type { Client } from "../../client.ts";
import { fsEndpoint } from "../../spaces/constants.ts";

export function shellSyscalls(client: Client): SysCallMapping {
  return {
    "shell.run": {
      callback: async (
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
      description: "Runs a shell command on the server and returns its output.",
      parameters: [
        { name: "command", type: "string", description: "Executable name." },
        {
          name: "arguments",
          type: "table",
          description: "Command arguments.",
        },
        {
          name: "stdin",
          type: "string",
          description: "Text supplied on standard input.",
          optional: true,
        },
      ],
      returns: [
        {
          type: "table",
          description: "stdout, stderr, and numeric exit code.",
        },
      ],
      examples: [
        {
          code: 'local result = shell.run("ls", {"-l"})\nprint(result.stdout)',
        },
        {
          code: 'local result = shell.run("cat", {}, "hello")\nprint(result.stdout)',
        },
      ],
    },
  };
}

function buildShellUrl(client: Client) {
  // Strip off the /.fs and replace with /.shell
  return `${client.httpSpacePrimitives.url.slice(0, -fsEndpoint.length)}/.shell`;
}
