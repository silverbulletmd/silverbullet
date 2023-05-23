import { SysCallMapping } from "../../plugos/system.ts";
import { SyncService } from "../sync_service.ts";

export function syncSyscalls(syncService: SyncService): SysCallMapping {
  return {
    "sync.isSyncing": (): Promise<boolean> => {
      return syncService.isSyncing();
    },
    "sync.hasInitialSyncCompleted": (): Promise<boolean> => {
      return syncService.hasInitialSyncCompleted();
    },
  };
}
