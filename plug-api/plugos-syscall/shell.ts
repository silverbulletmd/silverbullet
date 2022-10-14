import { syscall } from "./syscall.ts";

export function run(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return syscall("shell.run", cmd, args);
}
