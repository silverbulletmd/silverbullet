import type { SpacePrimitives } from "./space_primitives.ts";
import { EventEmitter } from "../plugos/event.ts";
import { plugPrefix } from "./constants.ts";
import type { FileMeta } from "../../type/index.ts";
import { notFoundError } from "../constants.ts";

type SyncHash = number;

// Tuple where the first value represents a lastModified timestamp for the primary space
// and the second item the lastModified value of the secondary space
export type SyncStatusItem = [SyncHash, SyncHash];

export type SyncSnapshot = Map<string, SyncStatusItem>;

export type SyncStatus = {
  filesProcessed: number;
  totalFiles: number;
};

export type SyncOptions = {
  conflictResolver: (
    name: string,
    snapshot: Map<string, SyncStatusItem>,
    primarySpace: SpacePrimitives,
    secondarySpace: SpacePrimitives,
  ) => Promise<number>;
  isSyncCandidate: (path: string) => boolean;
};

type SyncDirection = "primary->secondary" | "secondary->primary";

export type SyncEvents = {
  fileSynced: (
    meta: FileMeta,
    direction: SyncDirection,
  ) => void | Promise<void>;
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
    private snapshot: SyncSnapshot,
    readonly options: SyncOptions,
  ) {
    super();
  }

  /**
   * Syncs all files in space.
   * @returns number of operations performed, or -1 when sync was already ongoing and nonSynced files
   */
  async syncFiles(): Promise<
    { nonSyncedFiles: Map<string, FileMeta>; operations: number }
  > {
    let operations = 0;
    const nonSyncedFiles: Map<string, FileMeta> = new Map();

    // Mutex behavior, only sync can happen at a time
    if (this.isSyncing) {
      console.warn("Sync already in progress...");
      return {
        operations: -1,
        nonSyncedFiles,
      };
    }
    this.isSyncing = true;
    console.log("[sync]", "Performing a full sync cycle...");

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
        ...this.snapshot.keys(),
        ...primaryFileMap.keys(),
        ...secondaryFileMap.keys(),
      ]);

      const sortedFilenames = [...allFilesToProcess];
      sortedFilenames.sort((a) => {
        // Just make sure that _plug/ files appear first
        // This is important for the initial sync: plugs are loaded the moment they are pulled into the space,
        // which would activate e.g. any indexing logic for the remaining space content
        // TODO: To verify if this is still true today
        return a.startsWith(plugPrefix) ? -1 : 1;
      });
      // console.log("[sync]", "Iterating over all files");
      let filesProcessed = 0;
      for (const name of sortedFilenames) {
        try {
          operations += await this.syncFile(
            name,
            primaryFileMap.get(name),
            secondaryFileMap.get(name),
            !nonSyncCandidates.has(name),
            nonSyncedFiles,
          );
          filesProcessed++;
          // Only report something significant
          if (operations > 1) {
            this.emit("syncProgress", {
              filesProcessed,
              totalFiles: sortedFilenames.length,
            });
          }
        } catch (e: any) {
          console.log("error", "Error syncing file", name, e.message);
        }
      }
    } catch (e: any) {
      console.log("error", "General sync error:", e.message);
      throw e;
    } finally {
      this.isSyncing = false;
      this.emit("snapshotUpdated", this.snapshot);
    }
    console.log("[sync]", "Sync complete, operations performed", operations);

    return {
      operations,
      nonSyncedFiles: nonSyncedFiles,
    };
  }

  /**
   * Syncs a single file from primary to secondary if there's a need
   * @returns number of operations performed, or -1 when sync was already ongoing
   */
  async syncSingleFile(
    path: string,
  ): Promise<number> {
    let operations = 0;

    // Mutex behavior, only sync can happen at a time
    if (this.isSyncing) {
      console.warn("Sync already in progress...");
      return -1;
    }
    this.isSyncing = true;
    console.log("[sync]", "Performing a single file sync", path);

    // Just for API compatibility, not used
    const nonSyncedFilesDummy = new Map<string, FileMeta>();

    try {
      const localHash = this.snapshot.get(path)?.[0];
      const primaryMeta = await this.primary.getFileMeta(path);
      if (primaryMeta.lastModified === localHash) {
        // No local changes, moving on
        return 0;
      }
      let secondaryMeta: FileMeta | undefined;
      try {
        // console.log("Making remote meta data call", name);
        secondaryMeta = await this.secondary.getFileMeta(path);
      } catch (e: any) {
        if (e.message === notFoundError.message) {
          // File doesn't exist remotely, that's ok
        } else {
          throw e;
        }
      }
      operations += await this.syncFile(
        path,
        primaryMeta,
        secondaryMeta,
        true,
        nonSyncedFilesDummy,
      );
    } catch (e: any) {
      console.log("error", "Error syncing file", path, e.message);
    } finally {
      this.isSyncing = false;
      this.emit("snapshotUpdated", this.snapshot);
    }

    return operations;
  }

  private async syncFile(
    name: string,
    primaryMeta: FileMeta | undefined,
    secondaryMeta: FileMeta | undefined,
    syncBack: boolean,
    nonSyncedFiles: Map<string, FileMeta>,
  ): Promise<number> {
    // console.log(
    //   "Syncing",
    //   name,
    //   primaryMeta?.lastModified,
    //   secondaryMeta?.lastModified,
    // );
    let operations = 0;

    if (
      primaryMeta !== undefined && secondaryMeta === undefined &&
      !this.snapshot.has(name)
    ) {
      // New file, created on primary, copy from primary to secondary
      console.log(
        "[sync]",
        "New file created on primary, copying to secondary",
        name,
      );
      const { data, meta } = await this.primary.readFile(name);
      const writtenMeta = await this.secondary.writeFile(
        name,
        data,
        false,
        meta,
      );
      this.snapshot.set(name, [
        meta.lastModified,
        writtenMeta.lastModified,
      ]);
      operations++;
      await this.emit("fileSynced", writtenMeta, "primary->secondary");
    } else if (
      secondaryMeta !== undefined && primaryMeta === undefined &&
      !this.snapshot.has(name)
    ) {
      // New file, created on secondary
      if (syncBack) {
        // Copy from secondary to primary
        console.log(
          "[sync]",
          "New file created on secondary, copying from secondary to primary",
          name,
        );
        const { data, meta } = await this.secondary.readFile(name);
        const writtenMeta = await this.primary.writeFile(
          name,
          data,
          false,
          meta,
        );
        this.snapshot.set(name, [
          writtenMeta.lastModified,
          meta.lastModified,
        ]);
        operations++;
        await this.emit("fileSynced", writtenMeta, "secondary->primary");
      } else { // !syncBack
        // This has syncBack set to false, which means we'll just update the nonSyncedFiles and snapshot
        console.log(
          "[sync]",
          "New file created on secondary, but only updating metadata",
          name,
        );
        nonSyncedFiles.set(name, secondaryMeta);
        this.snapshot.set(name, [
          secondaryMeta.lastModified,
          secondaryMeta.lastModified,
        ]);
      }
    } else if (
      primaryMeta !== undefined && this.snapshot.has(name) &&
      secondaryMeta === undefined
    ) {
      // File deleted on secondary
      if (syncBack) {
        console.log(
          "[sync]",
          "File deleted on secondary, deleting from primary",
          name,
        );
        await this.primary.deleteFile(name);
        this.snapshot.delete(name);
        operations++;
      } else { // !syncBack
        console.log(
          "[sync]",
          "File deleted on secondary, only updating snapshot",
          name,
        );
        try {
          // It's possible that there is a local copy anyway (if it started out there, so let's attempt to delete it just in case, but fail silently)
          await this.primary.deleteFile(name);
          console.info("[sync]", "Deleted local copy on primary", name);
          operations++;
        } catch {
          // Fail silently, likely the file doesn't exist
        }
        this.snapshot.delete(name);
      }
    } else if (
      secondaryMeta !== undefined && this.snapshot.has(name) &&
      primaryMeta === undefined && syncBack
    ) {
      // File deleted on primary
      console.log(
        "[sync]",
        "File deleted on primary, deleting from secondary",
        name,
      );
      await this.secondary.deleteFile(name);
      this.snapshot.delete(name);
      operations++;
    } else if (
      this.snapshot.has(name) && primaryMeta === undefined &&
      secondaryMeta === undefined
    ) {
      // File deleted on both sides, :shrug:
      console.log(
        "[sync]",
        "File deleted on both ends, deleting from snapshot",
        name,
      );
      this.snapshot.delete(name);
      operations++;
    } else if (
      primaryMeta !== undefined && secondaryMeta !== undefined &&
      this.snapshot.get(name) &&
      primaryMeta.lastModified !== this.snapshot.get(name)![0] &&
      secondaryMeta.lastModified === this.snapshot.get(name)![1]
    ) {
      // File has changed on primary, but not secondary: copy from primary to secondary
      console.log(
        "[sync]",
        "File changed on primary, copying to secondary",
        name,
      );
      const { data, meta } = await this.primary.readFile(name);
      const writtenMeta = await this.secondary.writeFile(
        name,
        data,
        false,
        meta,
      );
      this.snapshot.set(name, [
        meta.lastModified,
        writtenMeta.lastModified,
      ]);
      operations++;
      await this.emit("fileSynced", writtenMeta, "primary->secondary");
    } else if (
      primaryMeta !== undefined && secondaryMeta !== undefined &&
      this.snapshot.get(name) &&
      secondaryMeta.lastModified !== this.snapshot.get(name)![1] &&
      primaryMeta.lastModified === this.snapshot.get(name)![0]
    ) {
      // File has changed on secondary, but not primary
      if (syncBack) {
        // Copy from secondary to primary
        console.log(
          "[sync]",
          "File has changed on secondary, but not primary: copy from secondary to primary",
          name,
        );
        const { data, meta } = await this.secondary.readFile(name);
        const writtenMeta = await this.primary.writeFile(
          name,
          data,
          false,
          meta,
        );
        this.snapshot.set(name, [
          writtenMeta.lastModified,
          meta.lastModified,
        ]);
        operations++;
        await this.emit("fileSynced", writtenMeta, "secondary->primary");
      } else { // !syncBack
        console.log(
          "[sync]",
          "File has changed on secondary, but not primary: shouldn't be synced",
          name,
        );
        nonSyncedFiles.set(name, secondaryMeta);
        this.snapshot.set(name, [
          secondaryMeta.lastModified,
          secondaryMeta.lastModified,
        ]);
        try {
          // It may be that the file does exist locally, but it will now be out of date, just delete it
          await this.primary.deleteFile(name);
          console.info(
            "[sync]",
            "Deleted local (out of date) copy on primary",
            name,
          );
          operations++;
        } catch {
          // Fail silently, likely the file doesn't exist
        }
      }
    } else if (
      ( // File changed on both ends, but we don't have any info in the snapshot (resync scenario?): have to run through conflict handling
        primaryMeta !== undefined && secondaryMeta !== undefined &&
        !this.snapshot.has(name)
      ) ||
      ( // File changed on both ends, CONFLICT!
        primaryMeta !== undefined && secondaryMeta !== undefined &&
        this.snapshot.get(name) &&
        secondaryMeta.lastModified !== this.snapshot.get(name)![1] &&
        primaryMeta.lastModified !== this.snapshot.get(name)![0]
      )
    ) {
      console.log(
        "[sync]",
        "File changed on both ends, potential conflict",
        name,
      );
      operations += await this.options.conflictResolver!(
        name,
        this.snapshot,
        this.primary,
        this.secondary,
      );
    } else {
      // Nothing needs to happen
      if (!syncBack) {
        nonSyncedFiles.set(name, secondaryMeta!);
      }
    }
    return operations;
  }

  // Strategy: Primary wins
  public static async primaryConflictResolver(
    name: string,
    snapshot: Map<string, SyncStatusItem>,
    primary: SpacePrimitives,
    secondary: SpacePrimitives,
  ): Promise<number> {
    console.log("[sync]", "Starting conflict resolution for", name);
    const filePieces = name.split(".");
    const fileNameBase = filePieces.slice(0, -1).join(".");
    const fileNameExt = filePieces[filePieces.length - 1];
    const pageData1 = await primary.readFile(name);
    const pageData2 = await secondary.readFile(name);

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

        snapshot.set(name, [
          pageData1.meta.lastModified,
          pageData2.meta.lastModified,
        ]);
        return 0;
      }
    }

    let operations = 0;
    const revisionFileName = filePieces.length === 1
      ? `${name}.conflicted:${pageData2.meta.lastModified}`
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
      name,
      pageData1.data,
      true,
    );
    operations++;

    // Updating snapshot
    snapshot.set(revisionFileName, [
      localConflictMeta.lastModified,
      remoteConflictMeta.lastModified,
    ]);

    snapshot.set(name, [pageData1.meta.lastModified, writeMeta.lastModified]);
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
}
