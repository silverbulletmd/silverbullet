import type { SysCallMapping } from "../../lib/plugos/system.ts";
import type { Client } from "../client.ts";

// TODO: Reimplement this
export function syncSyscalls(editor: Client): SysCallMapping {
  return {
    "sync.isSyncing": (): Promise<boolean> => {
      // return editor.syncService.isSyncing();
      return Promise.resolve(false);
    },

    "sync.hasInitialSyncCompleted": (): Promise<boolean> => {
      return Promise.resolve(true);
      // return editor.syncService.hasInitialSyncCompleted();
    },
    "sync.performFileSync": (_ctx, path: string): Promise<void> => {
      // return editor.syncService.performFileSync(path);
      return Promise.resolve();
    },
    "sync.performSpaceSync": (): Promise<number> => {
      // return editor.syncService.performSpaceSync();
      return Promise.resolve(0);
    },
  };
}
