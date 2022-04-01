import { syscall } from "./syscall";

export async function invokeFunctionOnServer(
  name: string,
  ...args: any[]
): Promise<any> {
  return syscall("system.invokeFunctionOnServer", name, ...args);
}
