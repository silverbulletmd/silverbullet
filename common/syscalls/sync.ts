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
      snapshot: Record<string, SyncStatusItem>,
    ): Promise<
      {
        snapshot: Record<string, SyncStatusItem>;
        operations: number;
        // The reason to not just throw an Error is so that the partially updated snapshot can still be saved
        error?: string;
      }
    > => {
      const syncSpace = new HttpSpacePrimitives(
        endpoint.url,
        endpoint.user,
        endpoint.password,
      );
      // Convert from JSON to a Map
      const syncStatusMap = new Map<string, SyncStatusItem>(
        Object.entries(snapshot),
      );
      const spaceSync = new SpaceSync(
        localSpace,
        syncSpace,
        syncStatusMap,
      );

      try {
        const operations = await spaceSync.syncFiles(
          SpaceSync.primaryConflictResolver,
        );
        return {
          // And convert back to JSON
          snapshot: Object.fromEntries(spaceSync.snapshot),
          operations,
        };
      } catch (e: any) {
        return {
          snapshot: Object.fromEntries(spaceSync.snapshot),
          operations: -1,
          error: e.message,
        };
      }
    },
  };
}
