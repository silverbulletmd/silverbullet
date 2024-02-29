import type { CommandDef } from "../../lib/command.ts";
import type { SyscallMeta } from "../types.ts";
import type { ParseTree } from "../lib/tree.ts";
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

export function invokeSpaceFunction(
  name: string,
  ...args: any[]
): Promise<any> {
  return syscall("system.invokeSpaceFunction", name, ...args);
}

export function applyAttributeExtractors(
  tags: string[],
  text: string,
  tree: ParseTree,
): Promise<Record<string, any>[]> {
  return syscall("system.applyAttributeExtractors", tags, text, tree);
}

export function reloadPlugs() {
  return syscall("system.reloadPlugs");
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
