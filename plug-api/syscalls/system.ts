import type { CommandDef } from "../../lib/command.ts";
import type { SyscallMeta } from "../types.ts";
import type { ParseTree } from "../lib/tree.ts";
import { syscall } from "../syscall.ts";
import type { Config } from "../../type/config.ts";

/**
 * System level syscalls
 * @module
 */

/**
 * Invoke a plug function
 * @param name a string representing the name of the function to invoke ("plug.functionName")
 * @param args arguments to pass to the function
 * @returns
 */
export function invokeFunction(
  name: string,
  ...args: any[]
): Promise<any> {
  return syscall("system.invokeFunction", name, ...args);
}

/**
 * Invoke a client command by name
 * Note: only available on the client
 * @param name name of the command
 * @param args arguments to pass to the command
 */
export function invokeCommand(name: string, args?: string[]): Promise<any> {
  return syscall("system.invokeCommand", name, args);
}

/**
 * Lists all commands available
 * @returns a map of all available commands
 */
export function listCommands(): Promise<Record<string, CommandDef>> {
  return syscall("system.listCommands");
}

/**
 * Lists all syscalls available
 * @returns a list of all available syscalls
 */
export function listSyscalls(): Promise<SyscallMeta[]> {
  return syscall("system.listSyscalls");
}

/**
 * Invoke a space function by name
 * @param name a string representing the name of the function to invoke
 * @param args arguments to pass to the function
 * @returns the value returned by the function
 */
export function invokeSpaceFunction(
  name: string,
  ...args: any[]
): Promise<any> {
  return syscall("system.invokeSpaceFunction", name, ...args);
}

/**
 * Applies attribute extractors to a ParseTree
 */
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
 * @param defaultValue the default value to return when the key is not found
 * @returns either the value of the key or all keys as a Record<string, any>
 */
export async function getSpaceConfig(
  key?: string,
  defaultValue?: any,
): Promise<any> {
  return (await syscall("system.getSpaceConfig", key)) ?? defaultValue;
}

/**
 * Trigger a reload of all plugs
 * @returns
 */
export function reloadPlugs(): Promise<void> {
  return syscall("system.reloadPlugs");
}

/**
 * Trigger an explicit reload of the configuration
 * @returns the new configuration
 */
export function reloadConfig(): Promise<Config> {
  return syscall("system.reloadConfig");
}

/**
 * Returns what runtime environment this plug is run in, e.g. "server" or "client" can be undefined, which would mean a hybrid environment (such as mobile)
 */
export function getEnv(): Promise<string | undefined> {
  return syscall("system.getEnv");
}

/**
 * Returns the current mode of the system, either "ro" (read-only) or "rw" (read-write)
 */
export function getMode(): Promise<"ro" | "rw"> {
  return syscall("system.getMode");
}

/**
 * Returns the SilverBullet version
 */
export function getVersion(): Promise<string> {
  return syscall("system.getVersion");
}
