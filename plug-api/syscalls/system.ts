import { syscall } from "../syscall.ts";
import type { CommandDef } from "../../lib/manifest.ts";
import type { SyscallMeta } from "../../type/index.ts";

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
 * Trigger a reload of all plugs
 * @returns
 */
export function reloadPlugs(): Promise<void> {
  return syscall("system.reloadPlugs");
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

export function getConfig<T = any>(
  key: string,
  defaultValue: any = undefined,
): Promise<T> {
  return syscall("system.getConfig", key, defaultValue);
}

export function wipeClient(logout = false): Promise<void> {
  return syscall("system.wipeClient", logout);
}
