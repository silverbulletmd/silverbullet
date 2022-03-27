import { SysCallMapping } from "../system";

export function transportSyscalls(
  names: string[],
  transportCall: (name: string, ...args: any[]) => Promise<any>
): SysCallMapping {
  let syscalls: SysCallMapping = {};

  for (let name of names) {
    syscalls[name] = (ctx, ...args: any[]) => {
      return transportCall(name, ...args);
    };
  }

  return syscalls;
}
