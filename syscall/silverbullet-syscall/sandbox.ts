import type { LogEntry } from "../../plugos/sandbox.ts";

export function getServerLogs(): Promise<LogEntry[]> {
  return syscall("sandbox.getServerLogs");
}
