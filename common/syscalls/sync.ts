import { SysCallMapping } from "../../plugos/system.ts";
import type { SyncEndpoint } from "../../plug-api/silverbullet-syscall/sync.ts";
import { SpaceSync, SyncStatusItem } from "../spaces/sync.ts";
import { HttpSpacePrimitives } from "../spaces/http_space_primitives.ts";
import { SpacePrimitives } from "../spaces/space_primitives.ts";

export function syncSyscalls(localSpace: SpacePrimitives): SysCallMapping {
  return {
    "sync.sync": async (
      _ctx,
      endpoint: SyncEndpoint,
      syncStatus: Record<string, SyncStatusItem>,
    ): Promise<
      { newStatus: Record<string, SyncStatusItem>; operations: number }
    > => {
      const syncSpace = new HttpSpacePrimitives(
        endpoint.url,
        endpoint.user,
        endpoint.password,
      );
      // Convert from JSON to a Map
      const syncStatusMap = new Map<string, SyncStatusItem>(
        Object.entries(syncStatus),
      );
      const spaceSync = new SpaceSync(
        localSpace,
        syncSpace,
        syncStatusMap,
      );

      const operations = await spaceSync.syncFiles(
        SpaceSync.primaryConflictResolver,
      );

      return {
        // And convert back to JSON
        newStatus: Object.fromEntries(spaceSync.snapshot),
        operations,
      };
    },
  };
}
