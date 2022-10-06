import { SyscallContext, SysCallMapping } from "../system.ts";

export function proxySyscalls(
  names: string[],
  transportCall: (
    ctx: SyscallContext,
    name: string,
    ...args: any[]
  ) => Promise<any>,
): SysCallMapping {
  let syscalls: SysCallMapping = {};

  for (let name of names) {
    syscalls[name] = (ctx, ...args: any[]) => {
      return transportCall(ctx, name, ...args);
    };
  }

  return syscalls;
}
