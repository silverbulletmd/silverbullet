import type { CommandDef } from "@silverbulletmd/web/hooks/command";
import { syscall } from "./syscall";

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

export async function getVersion(): Promise<string> {
  return syscall("system.getVersion");
}

export async function reloadPlugs() {
  syscall("system.reloadPlugs");
}
