import { SpaceSync, SyncStatusItem } from "$common/spaces/sync.ts";
import { MemoryKvPrimitives } from "$lib/data/memory_kv_primitives.ts";
import { determineStorageBackend } from "../server/storage_backend.ts";

export async function syncCommand(
  options: {
    snapshot?: string;
    wipeSecondary?: boolean;
  },
  primary: string,
  secondary: string,
) {
  const memoryKv = new MemoryKvPrimitives();
  console.log("Going to synchronize", primary, "and", secondary);

  const primarySpacePrimitives = await determineStorageBackend(
    memoryKv,
    primary,
  );
  const secondarySpacePrimitives = await determineStorageBackend(
    memoryKv,
    secondary,
  );

  if (options.wipeSecondary) {
    if (
      !confirm(
        `About to wipe the secondary storage at ${secondary}, are you sure?`,
      )
    ) {
      return;
    }
    const allFiles = await secondarySpacePrimitives.fetchFileList();
    for (const file of allFiles) {
      try {
        console.log("Deleting", file.name);
        await secondarySpacePrimitives.deleteFile(file.name);
      } catch (e: any) {
        console.warn("Failed to delete file", file.name, e.message);
      }
    }
    console.log("Done wiping secondary storage.");
  }

  const sync = new SpaceSync(primarySpacePrimitives, secondarySpacePrimitives, {
    conflictResolver: SpaceSync.primaryConflictResolver,
    isSyncCandidate: () => true,
  });
  let snapshot = new Map<string, SyncStatusItem>();
  if (options.snapshot) {
    try {
      snapshot = new Map(
        Object.entries(JSON.parse(await Deno.readTextFile(options.snapshot))),
      );
    } catch (e) {
      console.warn(
        "Failed to read snapshot file",
        e.message,
        "using empty snapshot",
      );
    }
  }

  const operations = await sync.syncFiles(snapshot);
  console.log("Sync completed, operations:", operations);
  if (options.snapshot) {
    await Deno.writeTextFile(
      options.snapshot,
      JSON.stringify(Object.fromEntries(snapshot.entries())),
    );
  }
}
