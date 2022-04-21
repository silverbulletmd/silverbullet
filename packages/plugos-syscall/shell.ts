import { syscall } from "./syscall";

export async function run(
  cmd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return syscall("shell.run", cmd, args);
}
