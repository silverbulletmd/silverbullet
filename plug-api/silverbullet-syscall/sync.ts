import type { SyncStatusItem } from "../../common/spaces/sync.ts";
import { syscall } from "./syscall.ts";

export type SyncEndpoint = {
  url: string;
  user?: string;
  password?: string;
};

// Perform a sync with the server, based on the given status (to be persisted)
// returns a new sync status to persist
export function sync(
  endpoint: SyncEndpoint,
  syncStatus: Record<string, SyncStatusItem>,
): Promise<Record<string, SyncStatusItem>> {
  return syscall("sync.sync", endpoint, syncStatus);
}
