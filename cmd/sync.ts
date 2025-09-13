import { SpaceSync, SyncSnapshot } from "../lib/spaces/sync.ts";
import { determineStorageBackend } from "../server/storage_backend.ts";

export async function syncCommand(
  options: {
    snapshot?: string;
    wipeSecondary?: boolean;
  },
  primary: string,
  secondary: string,
) {
  console.log("Going to synchronize", primary, "and", secondary);

  const primarySpacePrimitives = determineStorageBackend(
    primary,
  );
  const secondarySpacePrimitives = determineStorageBackend(
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

  let snapshot = new SyncSnapshot();
  if (options.snapshot) {
    try {
      snapshot = SyncSnapshot.fromJSON(
        JSON.parse(await Deno.readTextFile(options.snapshot)),
      );
    } catch (e: any) {
      console.warn(
        "Failed to read snapshot file",
        e.message,
        "using empty snapshot",
      );
    }
  }
  const sync = new SpaceSync(
    primarySpacePrimitives,
    secondarySpacePrimitives,
    {
      conflictResolver: SpaceSync.primaryConflictResolver,
      isSyncCandidate: () => true,
    },
  );

  if (options.snapshot) {
    sync.on({
      snapshotUpdated: async (snapshot) => {
        await Deno.writeTextFile(
          options.snapshot!,
          JSON.stringify(snapshot.toJSON()),
        );
      },
    });
  }

  await sync.syncFiles(snapshot);
}
