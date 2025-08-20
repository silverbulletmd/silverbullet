import type { SysCallMapping } from "../../lib/plugos/system.ts";
import type { Client } from "../client.ts";

export function syncSyscalls(editor: Client): SysCallMapping {
  return {
    "sync.isSyncing": (): Promise<boolean> => {
      return editor.syncService.isSyncing();
    },
    "sync.hasInitialSyncCompleted": (): Promise<boolean> => {
      return editor.syncService.hasInitialSyncCompleted();
    },
    "sync.performFileSync": (_ctx, path: string): Promise<void> => {
      return editor.syncService.performFileSync(path);
    },
    "sync.performSpaceSync": (): Promise<number> => {
      return editor.syncService.performSpaceSync();
    },
  };
}
