import { SysCallMapping } from "../system.ts";

export function proxySyscalls(
  names: string[],
  transportCall: (
    name: string,
    ...args: any[]
  ) => Promise<any>,
): SysCallMapping {
  const syscalls: SysCallMapping = {};

  for (const name of names) {
    syscalls[name] = (...args: any[]) => {
      return transportCall(name, ...args);
    };
  }

  return syscalls;
}
