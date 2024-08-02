import type { CommandDef } from "../../lib/command.ts";
import type { SyscallMeta } from "../types.ts";
import type { ParseTree } from "../lib/tree.ts";
import { syscall } from "../syscall.ts";
import { Config } from "$type/config.ts";

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

/**
 * Loads a particular space configuration key (or all of them when no key is spacified)
 * @param key the key to load, when not specified, all keys are loaded
 * @returns either the value of the key or all keys as a Record<string, any>
 */
export async function getSpaceConfig(
  key?: string,
  defaultValue?: any,
): Promise<any> {
  return (await syscall("system.getSpaceConfig", key)) ?? defaultValue;
}

export function reloadPlugs(): Promise<void> {
  return syscall("system.reloadPlugs");
}

export function reloadConfig(): Promise<Config> {
  return syscall("system.reloadConfig");
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
