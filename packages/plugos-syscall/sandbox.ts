import type { LogEntry } from "../plugos/sandbox.ts";

export async function getLogs(): Promise<LogEntry[]> {
  return syscall("sandbox.getLogs");
}
