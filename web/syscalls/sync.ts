import { SysCallMapping } from "../../plugos/system.ts";
import type { Editor } from "../editor.ts";

export function syncSyscalls(editor: Editor): SysCallMapping {
  return {
    "sync.isSyncing": (): Promise<boolean> => {
      return editor.syncService.isSyncing();
    },
    "sync.hasInitialSyncCompleted": (): Promise<boolean> => {
      return editor.syncService.hasInitialSyncCompleted();
    },
  };
}
