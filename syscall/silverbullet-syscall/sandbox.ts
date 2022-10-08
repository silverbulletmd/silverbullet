import type { LogEntry } from "@plugos/plugos/sandbox";

export async function getServerLogs(): Promise<LogEntry[]> {
  return syscall("sandbox.getServerLogs");
}
