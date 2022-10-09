import type { CommandDef } from "../../web/hooks/command.ts";
import { syscall } from "./syscall.ts";

export function invokeFunction(
  env: string,
  name: string,
  ...args: any[]
): Promise<any> {
  return syscall("system.invokeFunction", env, name, ...args);
}

// Only available on the client
export function invokeCommand(name: string): Promise<any> {
  return syscall("system.invokeCommand", name);
}

// Only available on the client
export function listCommands(): Promise<{ [key: string]: CommandDef }> {
  return syscall("system.listCommands");
}

export function reloadPlugs() {
  syscall("system.reloadPlugs");
}
