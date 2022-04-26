import { syscall } from "./syscall";

export async function invokeFunction(
  env: string,
  name: string,
  ...args: any[]
): Promise<any> {
  return syscall("system.invokeFunction", env, name, ...args);
}

export async function reloadPlugs() {
  return syscall("system.reloadPlugs");
}
