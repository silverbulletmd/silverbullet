import type { ShellStreamClient } from "../../web/shell_stream_client.ts";
import { syscall } from "../syscall.ts";

/**
 * Interface for the shell stream client
 */
export interface ShellStream {
  /**
   * Send data to the process stdin
   */
  send(data: string): void;

  /**
   * Send a signal to the process
   */
  kill(signal: string): void;

  /**
   * Close the connection
   */
  close(): void;
}

/**
 * Runs a shell command.
 * @param cmd the command to run
 * @param args the arguments to pass to the command
 * @returns the stdout, stderr, and exit code of the command
 */
export function run(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return syscall("shell.run", cmd, args);
}

/**
 * Runs a shell command with streaming I/O.
 * @param cmd the command to run
 * @param args the arguments to pass to the command
 * @returns a shell stream client for interacting with the process
 */
export function spawn(
  cmd: string,
  args: string[],
): Promise<ShellStreamClient> {
  return syscall("shell.spawn", cmd, args);
}
