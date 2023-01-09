import type { FileMeta } from "../types.ts";
import { SpacePrimitives } from "./space_primitives.ts";
import { TrashSpacePrimitives } from "./trash_space_primitives.ts";

export class SpaceSync {
  constructor(
    private primary: TrashSpacePrimitives,
    private secondary: TrashSpacePrimitives,
    public primaryLastSync: number,
    public secondaryLastSync: number,
  ) {}

  // Strategy: Primary wins
  public static primaryConflictResolver(
    primary: SpacePrimitives,
    secondary: SpacePrimitives,
  ): (fileMeta1: FileMeta, fileMeta2: FileMeta) => Promise<void> {
    return async (pageMeta1, pageMeta2) => {
      const pageName = pageMeta1.name;
      const revisionPageName =
        `${pageName}.conflicted.${pageMeta2.lastModified}`;
      // Copy secondary to conflict copy
      const oldFileData = await secondary.readFile(pageName, "arraybuffer");
      await secondary.writeFile(
        revisionPageName,
        "arraybuffer",
        oldFileData.data,
      );

      // Write replacement on top
      const newFileData = await primary.readFile(pageName, "arraybuffer");
      await secondary.writeFile(
        pageName,
        "arraybuffer",
        newFileData.data,
        true,
        newFileData.meta.lastModified,
      );
    };
  }

  syncCandidates(files: FileMeta[]): FileMeta[] {
    return files.filter((f) => !f.name.startsWith("_plug/"));
  }

  async syncFiles(
    conflictResolver?: (
      fileMeta1: FileMeta,
      fileMeta2: FileMeta,
    ) => Promise<void>,
  ): Promise<number> {
    let syncOps = 0;

    const {
      files: primaryAllPages,
      trashFiles: primaryAllTrash,
      timestamp: primarySyncTimestamp,
    } = await this.primary.seggregateFileList();
    const allFilesPrimary = new Map(
      this.syncCandidates(primaryAllPages).map((p) => [p.name, p]),
    );
    const {
      files: secondaryAllFilesSet,
      trashFiles: secondaryAllTrash,
      timestamp: secondarySyncTimestamp,
    } = await this.secondary.seggregateFileList();
    const allFilesSecondary = new Map(
      this.syncCandidates(secondaryAllFilesSet).map((p) => [p.name, p]),
    );

    const allTrashPrimary = new Map(
      primaryAllTrash
        // Filter out old trash
        .filter((p) => p.lastModified > this.primaryLastSync)
        .map((p) => [p.name, p]),
    );
    const allTrashSecondary = new Map(
      secondaryAllTrash
        // Filter out old trash
        .filter((p) => p.lastModified > this.secondaryLastSync)
        .map((p) => [p.name, p]),
    );

    // Iterate over all pages on the primary first
    for (const [name, fileMetaPrimary] of allFilesPrimary.entries()) {
      const fileMetaSecondary = allFilesSecondary.get(fileMetaPrimary.name);
      if (!fileMetaSecondary) {
        // New page on primary
        // Let's check it's not on the deleted list
        if (allTrashSecondary.has(name)) {
          // Explicitly deleted, let's skip
          continue;
        }

        // Push from primary to secondary
        console.log("New page on primary", name, "syncing to secondary");
        const pageData = await this.primary.readFile(name, "arraybuffer");
        await this.secondary.writeFile(
          name,
          "arraybuffer",
          pageData.data,
          true,
          secondarySyncTimestamp, // The reason for this is to not include it in the next sync cycle, we cannot blindly use the lastModified date due to time skew
        );
        syncOps++;
      } else {
        // Existing file
        if (fileMetaPrimary.lastModified > this.primaryLastSync) {
          // Primary updated since last sync
          if (fileMetaSecondary.lastModified > this.secondaryLastSync) {
            // Secondary also updated! CONFLICT
            if (conflictResolver) {
              await conflictResolver(fileMetaPrimary, fileMetaSecondary);
            } else {
              throw Error(
                `Sync conflict for ${name} with no conflict resolver specified`,
              );
            }
          } else {
            // Ok, not changed on secondary, push it secondary
            console.log(
              "Changed page on primary",
              name,
              "syncing to secondary",
            );
            const fileData = await this.primary.readFile(name, "arraybuffer");
            await this.secondary.writeFile(
              name,
              "arraybuffer",
              fileData.data,
              false,
              secondarySyncTimestamp,
            );
            syncOps++;
          }
        } else if (fileMetaSecondary.lastModified > this.secondaryLastSync) {
          // Secondary updated, but not primary (checked above)
          // Push from secondary to primary
          console.log("Changed page on secondary", name, "syncing to primary");
          const fileData = await this.secondary.readFile(name, "arraybuffer");
          await this.primary.writeFile(
            name,
            "arraybuffer",
            fileData.data,
            false,
            primarySyncTimestamp,
          );
          syncOps++;
        } else {
          // Neither updated, no-op
        }
      }
    }

    // Now do a simplified version in reverse, only detecting new pages
    for (const [name, fileMetaSecondary] of allFilesSecondary.entries()) {
      if (!allFilesPrimary.has(fileMetaSecondary.name)) {
        // New page on secondary
        // Let's check it's not on the deleted list
        if (allTrashPrimary.has(name)) {
          // Explicitly deleted, let's skip
          continue;
        }
        // Push from secondary to primary
        console.log("New page on secondary", name, "pushing to primary");
        const fileData = await this.secondary.readFile(name, "arraybuffer");
        await this.primary.writeFile(
          name,
          "arraybuffer",
          fileData.data,
          false,
          primarySyncTimestamp,
        );
        syncOps++;
      }
    }

    // And finally, let's trash some pages
    for (const fileToDelete of allTrashPrimary.values()) {
      console.log("Deleting", fileToDelete.name, "on secondary");
      try {
        await this.secondary.deleteFile(
          fileToDelete.name,
          secondarySyncTimestamp,
        );
        syncOps++;
      } catch (e: any) {
        console.log("Page already gone", e.message);
      }
    }

    for (const fileToDelete of allTrashSecondary.values()) {
      console.log("Deleting", fileToDelete.name, "on primary");
      try {
        await this.primary.deleteFile(fileToDelete.name, primarySyncTimestamp);
        syncOps++;
      } catch (e: any) {
        console.log("Page already gone", e.message);
      }
    }

    // Setting last sync time to the timestamps we got back when fetching the page lists on each end
    this.primaryLastSync = primarySyncTimestamp;
    this.secondaryLastSync = secondarySyncTimestamp;

    return syncOps;
  }
}
