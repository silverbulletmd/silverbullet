import type { LogEntry } from "../../plugos/sandbox.ts";

export function getLogs(): Promise<LogEntry[]> {
  return syscall("sandbox.getLogs");
}
