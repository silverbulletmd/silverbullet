import type { CommandDef } from "$common/hooks/command.ts";
import { SyscallMeta } from "$type/types.ts";
import { syscall } from "../syscall.ts";

export function invokeFunction(
  name: string,
  ...args: any[]
): Promise<any> {
  return syscall("system.invokeFunction", name, ...args);
}

// Only available on the client
export function invokeCommand(name: string, args?: string[]): Promise<any> {
  return syscall("system.invokeCommand", name, args);
}

// Only available on the client
export function listCommands(): Promise<{ [key: string]: CommandDef }> {
  return syscall("system.listCommands");
}

export function listSyscalls(): Promise<SyscallMeta[]> {
  return syscall("system.listSyscalls");
}

export function reloadPlugs() {
  syscall("system.reloadPlugs");
}

// Returns what runtime environment this plug is run in, e.g. "server" or "client" can be undefined, which would mean a hybrid environment (such as mobile)
export function getEnv(): Promise<string | undefined> {
  return syscall("system.getEnv");
}

export function getMode(): Promise<"ro" | "rw"> {
  return syscall("system.getMode");
}

export function getVersion(): Promise<string> {
  return syscall("system.getVersion");
}
