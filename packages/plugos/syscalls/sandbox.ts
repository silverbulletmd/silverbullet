import { LogEntry } from "../sandbox";
import { SysCallMapping, System } from "../system";

export default function sandboxSyscalls(system: System<any>): SysCallMapping {
  return {
    "sandbox.getLogs": async (ctx): Promise<LogEntry[]> => {
      let allLogs: LogEntry[] = [];
      for (let plug of system.loadedPlugs.values()) {
        allLogs = allLogs.concat(plug.sandbox.logBuffer);
      }
      allLogs = allLogs.sort((a, b) => a.date - b.date);
      return allLogs;
    },
  };
}
