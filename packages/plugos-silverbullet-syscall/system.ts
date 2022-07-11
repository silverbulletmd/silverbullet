import { syscall } from "./syscall";

export async function invokeFunction(
  env: string,
  name: string,
  ...args: any[]
): Promise<any> {
  return syscall("system.invokeFunction", env, name, ...args);
}

export async function invokeCommand(name: string): Promise<any> {
  return syscall("system.invokeCommand", name);
}

export async function getVersion(): Promise<string> {
  return syscall("system.getVersion");
}

export async function reloadPlugs() {
  syscall("system.reloadPlugs");
}
