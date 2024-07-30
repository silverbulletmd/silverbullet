import type { SysCallMapping } from "../../lib/plugos/system.ts";
import type { ShellResponse } from "../../type/rpc.ts";
import type { ShellBackend } from "../shell_backend.ts";

export function shellSyscalls(shellBackend: ShellBackend): SysCallMapping {
  return {
    "shell.run": (
      _ctx,
      cmd: string,
      args: string[],
    ): Promise<ShellResponse> => {
      return shellBackend.handle({ cmd, args });
    },
  };
}
