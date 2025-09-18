import type { SpacePrimitives } from "./space_primitives.ts";
import { EventEmitter } from "../plugos/event.ts";
import { plugPrefix } from "./constants.ts";
import type { FileMeta } from "../../type/index.ts";
import { notFoundError } from "../constants.ts";
import { processWithConcurrency } from "../async.ts";

const syncConcurrency = 3;

type SyncHash = number;

// Tuple where the first value represents a lastModified timestamp for the primary space
// and the second item the lastModified value of the secondary space
export type SyncStatusItem = [SyncHash, SyncHash];

export class SyncSnapshot {
  constructor(
    public files: Map<string, SyncStatusItem> = new Map(),
    public nonSyncedFiles: Map<string, FileMeta> = new Map(),
  ) {
    this.files = files;
    this.nonSyncedFiles = nonSyncedFiles;
  }

  toJSON(): any {
    return {
      files: Object.fromEntries(this.files),
      nonSyncedFiles: Object.fromEntries(this.nonSyncedFiles),
    };
  }

  static fromJSON(json: any | undefined): SyncSnapshot {
    return new SyncSnapshot(
      new Map(Object.entries(json?.files || {})),
      new Map(Object.entries(json?.nonSyncedFiles || {})),
    );
  }
}

export type SyncStatus = {
  filesProcessed: number;
  totalFiles: number;
};

export type SyncOptions = {
  conflictResolver: (
    path: string,
    snapshot: SyncSnapshot,
    primarySpace: SpacePrimitives,
    secondarySpace: SpacePrimitives,
  ) => Promise<number>;
  isSyncCandidate: (path: string) => boolean;
};

type SyncDirection = "primary->secondary" | "secondary->primary";

export type SyncEvents = {
  syncProgress: (syncStatus: SyncStatus) => void | Promise<void>;
  snapshotUpdated: (snapshot: SyncSnapshot) => void | Promise<void>;
};

// Implementation of this algorithm: https://unterwaditzer.net/2016/sync-algorithm.html
export class SpaceSync extends EventEmitter<SyncEvents> {
  // Sync mutex (only one sync operation at a time)
  private isSyncing = false;

  constructor(
    private primary: SpacePrimitives,
    private secondary: SpacePrimitives,
    readonly options: SyncOptions,
  ) {
    super();
  }

  /**
   * Syncs all files in space.
   * If this completes successfully (with operations >= 0), a full space sync completed successfully.
   * @param snapshot - The current snapshot of the space (will be updated in place)
   * @returns number of operations performed, or -1 when sync was already ongoing and nonSynced files
   */
  public async syncFiles(snapshot: SyncSnapshot): Promise<number> {
    let operations = 0;

    // Mutex behavior, only sync can happen at a time
    if (this.isSyncing) {
      console.warn("Sync already in progress...");
      return -1;
    }
    this.isSyncing = true;
    console.log("[sync]", "Performing a full sync cycle...");
    const startTime = Date.now();

    try {
      const primaryAllPages = await this.primary.fetchFileList();
      const secondaryAllPages = await this.secondary.fetchFileList();

      // Assumption: the primary is local, and _all_ files should be synced to the secondary
      // However, the secondary is remote, and only a subset of files should be synced from it
      const nonSyncCandidates = this.getNonSyncCandidates(secondaryAllPages);

      const primaryFileMap = new Map<string, FileMeta>(
        primaryAllPages.map((m) => [m.name, m]),
      );
      const secondaryFileMap = new Map<string, FileMeta>(
        secondaryAllPages.map((m) => [m.name, m]),
      );

      const allFilesToProcess = new Set([
        ...snapshot.files.keys(),
        ...primaryFileMap.keys(),
        ...secondaryFileMap.keys(),
      ]);

      const sortedPaths = [...allFilesToProcess];
      sortedPaths.sort((a) => {
        // Just make sure that _plug/ files appear first
        // This is important for the initial sync: plugs are loaded the moment they are pulled into the space,
        // which would activate e.g. any indexing logic for the remaining space content
        // TODO: To verify if this is still true today
        return a.startsWith(plugPrefix) ? -1 : 1;
      });
      // console.log("[sync]", "Iterating over all files");
      let filesProcessed = 0;
      await processWithConcurrency(sortedPaths, async (path) => {
        const fileOperations = await this.syncFile(
          path,
          primaryFileMap.get(path),
          secondaryFileMap.get(path),
          !nonSyncCandidates.has(path),
          snapshot,
        );
        operations = operations + fileOperations;
        filesProcessed++;
        if (fileOperations > 1) {
          // Only report something significant
          this.emit("syncProgress", {
            filesProcessed,
            totalFiles: sortedPaths.length,
          });
        }
      }, syncConcurrency);
      console.log(
        "[Sync]",
        "Completed:",
        operations,
        "operations in",
        ((Date.now() - startTime) / 1000) + "s",
      );
    } finally {
      this.isSyncing = false;
      this.emit("snapshotUpdated", snapshot);
    }

    return operations;
  }

  /**
   * Syncs a single file from primary to secondary.
   * Used to more actively sync currently open files.
   * @returns number of operations performed, or -1 when sync was already ongoing
   */
  public async syncSingleFile(
    path: string,
    snapshot: SyncSnapshot,
  ): Promise<number> {
    // Mutex behavior, only sync cycle can happen at a time
    if (this.isSyncing) {
      console.warn("[sync]", "Sync already in progress...");
      return -1;
    }
    if (snapshot.nonSyncedFiles.has(path)) {
      console.info(
        "[sync]",
        "Was asked to sync marked as non-synced, skipping",
        path,
      );
      return 0;
    }

    this.isSyncing = true;
    console.log("[sync]", "Performing a single file sync", path);

    let operations = 0;

    try {
      const primaryMeta = await this.primary.getFileMeta(path);
      let secondaryMeta: FileMeta | undefined;
      try {
        secondaryMeta = await this.secondary.getFileMeta(path);
      } catch (e: any) {
        if (e.message === notFoundError.message) {
          // File doesn't exist remotely, that's ok
        } else {
          throw e;
        }
      }
      operations = await this.syncFile(
        path,
        primaryMeta,
        secondaryMeta,
        true,
        snapshot,
      );
    } catch (e: any) {
      console.log("error", "Error syncing file", path, e.message);
    } finally {
      this.isSyncing = false;
      this.emit("snapshotUpdated", snapshot);
    }

    return operations;
  }

  /**
   * Syncs a single file
   * @param path The path of the file to sync
   * @param primaryMeta The metadata of the file on the primary space
   * @param secondaryMeta The metadata of the file on the secondary space
   * @param syncBack Whether this a file that is marked to be synced
   * @param snapshot The snapshot of the file status (updated in place!)
   * @returns The number of operations performed
   */
  private async syncFile(
    path: string,
    primaryMeta: FileMeta | undefined,
    secondaryMeta: FileMeta | undefined,
    syncBack: boolean,
    snapshot: SyncSnapshot,
  ): Promise<number> {
    let operations = 0;

    if (
      primaryMeta !== undefined && secondaryMeta === undefined &&
      !snapshot.files.has(path)
    ) {
      // New file, created on primary, copy from primary to secondary
      console.log(
        "[sync]",
        "New file created on primary, copying to secondary",
        path,
      );
      const { data, meta } = await this.primary.readFile(path);
      const writtenMeta = await this.secondary.writeFile(
        path,
        data,
        meta,
      );
      // Update file snapshot
      snapshot.files.set(path, [
        meta.lastModified,
        writtenMeta.lastModified,
      ]);
      // Let's make sure this file is not marked as nonSynced, because we have a local copy
      snapshot.nonSyncedFiles.delete(path);
      operations++;
    } else if (
      secondaryMeta !== undefined && ((
        // Scenario: a new file was created on the secondary
        primaryMeta === undefined &&
        !snapshot.files.has(path)
      ) || (
        // Scenario: a file that was previously unsynced, should now be synced
        snapshot.nonSyncedFiles.has(path) && syncBack &&
        // because we don't have it yet
        primaryMeta === undefined
      ))
    ) {
      // New file to sync, present on secondary
      if (syncBack) {
        // Copy from secondary to primary
        console.log(
          "[sync]",
          "New file to sync on secondary, copying from secondary to primary",
          path,
        );
        const { data, meta } = await this.secondary.readFile(path);
        const writtenMeta = await this.primary.writeFile(
          path,
          data,
          meta,
        );
        // Update file snapshot
        snapshot.files.set(path, [
          writtenMeta.lastModified,
          meta.lastModified,
        ]);
        // Make sure the file is not marked as nonSynced anymore
        snapshot.nonSyncedFiles.delete(path);
        operations++;
      } else { // !syncBack
        // This has syncBack set to false, which means we'll just update the nonSyncedFiles and snapshot
        console.log(
          "[sync]",
          "New file created on secondary, but only updating metadata",
          path,
        );
        snapshot.files.set(path, [
          secondaryMeta.lastModified,
          secondaryMeta.lastModified,
        ]);
        snapshot.nonSyncedFiles.set(path, secondaryMeta);
      }
    } else if (
      primaryMeta !== undefined && snapshot.files.has(path) &&
      secondaryMeta === undefined
    ) {
      // File deleted on secondary
      if (syncBack) {
        snapshot.files.delete(path);
        if (snapshot.nonSyncedFiles.has(path)) {
          // This is the scenario where in the previous sync this file was not synced while in this new one it is
          console.log(
            "[sync]",
            "File deleted on secondary, but wasn't synced on primary, so skipping",
            path,
          );
          // Keeping non-synced files up-to-date
          snapshot.nonSyncedFiles.delete(path);
        } else {
          console.log(
            "[sync]",
            "File deleted on secondary, deleting from primary",
            path,
          );
          await this.primary.deleteFile(path);
        }
        operations++;
      } else { // !syncBack
        console.log(
          "[sync]",
          "File deleted on secondary, only updating snapshot",
          path,
        );
        try {
          // It's possible that there is a local copy anyway (if it started out there, so let's attempt to delete it just in case, but fail silently)
          await this.primary.deleteFile(path);
          console.info("[sync]", "Deleted local copy on primary", path);
          operations++;
        } catch {
          // Fail silently, likely the file doesn't exist
        }
        snapshot.files.delete(path);
        snapshot.nonSyncedFiles.delete(path);
      }
    } else if (
      // The file is on the secondary, and not on the primary
      secondaryMeta !== undefined && snapshot.files.has(path) &&
      primaryMeta === undefined &&
      // And we're talking about a synced file
      syncBack
    ) {
      // File deleted on primary
      console.log(
        "[sync]",
        "File deleted on primary, deleting from secondary",
        path,
      );
      await this.secondary.deleteFile(path);
      snapshot.files.delete(path);
      snapshot.nonSyncedFiles.delete(path);
      operations++;
    } else if (
      snapshot.files.has(path) && primaryMeta === undefined &&
      secondaryMeta === undefined
    ) {
      // File deleted on both sides, :shrug:
      console.log(
        "[sync]",
        "File deleted on both ends, deleting from snapshot",
        path,
      );
      snapshot.files.delete(path);
      snapshot.nonSyncedFiles.delete(path);
      operations++;
    } else if (
      primaryMeta !== undefined && secondaryMeta !== undefined &&
      snapshot.files.get(path) &&
      primaryMeta.lastModified !== snapshot.files.get(path)![0] &&
      secondaryMeta.lastModified === snapshot.files.get(path)![1]
    ) {
      // File has changed on primary, but not secondary: copy from primary to secondary
      console.log(
        "[sync]",
        "File changed on primary, copying to secondary",
        path,
      );
      const { data, meta } = await this.primary.readFile(path);
      const writtenMeta = await this.secondary.writeFile(
        path,
        data,
        meta,
      );
      snapshot.files.set(path, [
        meta.lastModified,
        writtenMeta.lastModified,
      ]);
      // Delete from non-synced files just in case, because we clearly have a local copy
      snapshot.nonSyncedFiles.delete(path);
      operations++;
    } else if (
      primaryMeta !== undefined && secondaryMeta !== undefined &&
      snapshot.files.get(path) &&
      primaryMeta.lastModified === snapshot.files.get(path)![0] &&
      secondaryMeta.lastModified !== snapshot.files.get(path)![1]
    ) {
      // File has changed on secondary, but not primary
      if (syncBack) {
        // Copy from secondary to primary
        console.log(
          "[sync]",
          "File has changed on secondary, but not primary: copy from secondary to primary",
          path,
        );
        const { data, meta } = await this.secondary.readFile(path);
        const writtenMeta = await this.primary.writeFile(
          path,
          data,
          meta,
        );
        snapshot.files.set(path, [
          writtenMeta.lastModified,
          meta.lastModified,
        ]);
        // Make sure it's not in nonSyncedFiles
        snapshot.nonSyncedFiles.delete(path);
        operations++;
      } else { // !syncBack
        console.log(
          "[sync]",
          "File has changed on secondary, but not primary: shouldn't be synced",
          path,
        );
        snapshot.files.set(path, [
          secondaryMeta.lastModified,
          secondaryMeta.lastModified,
        ]);
        snapshot.nonSyncedFiles.set(path, secondaryMeta);
        try {
          // It may be that the file does exist locally, but it will now be out of date, just delete it
          await this.primary.deleteFile(path);
          console.info(
            "[sync]",
            "Deleted local (out of date) copy on primary",
            path,
          );
          operations++;
        } catch {
          // Fail silently, likely the file doesn't exist
        }
      }
    } else if (
      ( // File changed on both ends, but we don't have any info in the snapshot (resync scenario?): have to run through conflict handling
        primaryMeta !== undefined && secondaryMeta !== undefined &&
        !snapshot.files.has(path)
      ) ||
      ( // File changed on both ends, CONFLICT!
        primaryMeta !== undefined && secondaryMeta !== undefined &&
        snapshot.files.get(path) &&
        primaryMeta.lastModified !== snapshot.files.get(path)![0] &&
        secondaryMeta.lastModified !== snapshot.files.get(path)![1]
      )
    ) {
      console.log(
        "[sync]",
        "File changed on both ends, potential conflict",
        path,
      );
      operations += await this.options.conflictResolver(
        path,
        snapshot,
        this.primary,
        this.secondary,
      );
    } else if (primaryMeta && secondaryMeta && !syncBack) {
      console.log(
        "[sync]",
        "File present locally, but no longer synced, deleting local copy of",
        path,
      );
      await this.primary.deleteFile(path);
      snapshot.nonSyncedFiles.set(path, secondaryMeta);
      operations += 1;
    } else {
      // Nothing needs to happen
      if (!syncBack && secondaryMeta) {
        snapshot.nonSyncedFiles.set(path, secondaryMeta);
      }
    }
    // End scene
    return operations;
  }

  getNonSyncCandidates(files: FileMeta[]): Map<string, FileMeta> {
    const nonSyncCandidates: Map<string, FileMeta> = new Map();
    files.forEach((meta) => {
      if (!this.options.isSyncCandidate(meta.name)) {
        nonSyncCandidates.set(meta.name, meta);
      }
    });
    return nonSyncCandidates;
  }

  // Strategy: Primary wins
  public static async primaryConflictResolver(
    path: string,
    snapshot: SyncSnapshot,
    primary: SpacePrimitives,
    secondary: SpacePrimitives,
  ): Promise<number> {
    console.log("[sync]", "Starting conflict resolution for", path);
    const filePieces = path.split(".");
    const fileNameBase = filePieces.slice(0, -1).join(".");
    const fileNameExt = filePieces[filePieces.length - 1];
    const pageData1 = await primary.readFile(path);
    const pageData2 = await secondary.readFile(path);

    let byteWiseMatch = true;
    const arrayBuffer1 = pageData1.data;
    const arrayBuffer2 = pageData2.data;
    if (arrayBuffer1.byteLength !== arrayBuffer2.byteLength) {
      byteWiseMatch = false;
    }
    if (byteWiseMatch) {
      // Byte-wise comparison
      for (let i = 0; i < arrayBuffer1.byteLength; i++) {
        if (arrayBuffer1[i] !== arrayBuffer2[i]) {
          byteWiseMatch = false;
          break;
        }
      }
      // Byte wise they're still the same, so no confict
      if (byteWiseMatch) {
        console.log("[sync]", "Files are the same, no conflict");

        snapshot.files.set(path, [
          pageData1.meta.lastModified,
          pageData2.meta.lastModified,
        ]);
        return 0;
      }
    }

    let operations = 0;
    const revisionFileName = filePieces.length === 1
      ? `${path}.conflicted:${pageData2.meta.lastModified}`
      : `${fileNameBase}.conflicted:${pageData2.meta.lastModified}.${fileNameExt}`;
    console.log(
      "[sync]",
      "Going to create conflicting copy",
      revisionFileName,
    );

    // Copy secondary to conflict copy
    const localConflictMeta = await primary.writeFile(
      revisionFileName,
      pageData2.data,
    );
    operations++;
    const remoteConflictMeta = await secondary.writeFile(
      revisionFileName,
      pageData2.data,
    );
    operations++;

    // Write replacement on top
    const writeMeta = await secondary.writeFile(
      path,
      pageData1.data,
    );
    operations++;

    // Updating snapshot
    snapshot.files.set(revisionFileName, [
      localConflictMeta.lastModified,
      remoteConflictMeta.lastModified,
    ]);

    snapshot.files.set(path, [
      pageData1.meta.lastModified,
      writeMeta.lastModified,
    ]);
    return operations;
  }
}
