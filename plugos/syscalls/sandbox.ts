import type { LogEntry } from "../sandbox.ts";
import type { SysCallMapping, System } from "../system.ts";

export default function sandboxSyscalls(system: System<any>): SysCallMapping {
  return {
    "sandbox.getLogs": (): LogEntry[] => {
      let allLogs: LogEntry[] = [];
      for (const plug of system.loadedPlugs.values()) {
        if (plug.sandbox) {
          allLogs = allLogs.concat(plug.sandbox.logBuffer);
        }
      }
      allLogs = allLogs.sort((a, b) => a.date - b.date);
      return allLogs;
    },
  };
}
