import type { LogEntry } from "@plugos/plugos/sandbox";

export async function getLogs(): Promise<LogEntry[]> {
  return syscall("sandbox.getLogs");
}
