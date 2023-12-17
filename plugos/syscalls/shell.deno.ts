import { ShellResponse } from "../../server/rpc.ts";
import type { SysCallMapping } from "../system.ts";

export function shellSyscalls(cwd: string): SysCallMapping {
  return {
    "shell.run": async (
      _ctx,
      cmd: string,
      args: string[],
    ): Promise<ShellResponse> => {
      const p = new Deno.Command(cmd, {
        args: args,
        cwd,
        stdout: "piped",
        stderr: "piped",
      });
      const output = await p.output();
      const stdout = new TextDecoder().decode(output.stdout);
      const stderr = new TextDecoder().decode(output.stderr);

      return { stdout, stderr, code: output.code };
    },
  };
}
