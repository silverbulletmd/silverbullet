import { syscall } from "../syscall.ts";

export function run(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return syscall("shell.run", cmd, args);
}
