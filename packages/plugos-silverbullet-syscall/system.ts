import type { CommandDef } from "../web/hooks/command.ts";
import { syscall } from "./syscall.ts";

export async function invokeFunction(
  env: string,
  name: string,
  ...args: any[]
): Promise<any> {
  return syscall("system.invokeFunction", env, name, ...args);
}

// Only available on the client
export async function invokeCommand(name: string): Promise<any> {
  return syscall("system.invokeCommand", name);
}

// Only available on the client
export async function listCommands(): Promise<{ [key: string]: CommandDef }> {
  return syscall("system.listCommands");
}

export async function reloadPlugs() {
  syscall("system.reloadPlugs");
}
