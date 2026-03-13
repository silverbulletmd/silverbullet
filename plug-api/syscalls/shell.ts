import { syscall } from "../syscall.ts";

/**
 * Runs a shell command.
 * @param cmd the command to run
 * @param args the arguments to pass to the command
 * @param stdin optional string to pass as stdin to the command
 * @returns the stdout, stderr, and exit code of the command
 */
export function run(
  cmd: string,
  args: string[],
  stdin?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return syscall("shell.run", cmd, args, stdin);
}

