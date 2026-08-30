/**
 * This is where the sync magic happens
 */

import { notFoundError } from "@silverbulletmd/silverbullet/constants";
import { processWithConcurrency } from "@silverbulletmd/silverbullet/lib/async";
import { hashSHA256 } from "@silverbulletmd/silverbullet/lib/crypto";
import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";
import mime from "mime";
import { EventEmitter } from "../plugos/event.ts";
import type { BaseStore } from "./base_store.ts";
import { stdLibPrefix } from "./constants.ts";
import {
  PreconditionFailedError,
  type ReconcileRequest,
  type ReconcileResponse,
  type WritePrecondition,
} from "./http_space_primitives.ts";
import type { SpacePrimitives } from "./space_primitives.ts";

const syncConcurrency = 5;

const mergeEligibleExtensions = new Set([
  "md",
  "txt",
  "lua",
  "css",
  "json",
  "yaml",
  "yml",
  "toml",
]);
const maxMergeEligibleSize = 1_048_576;

export function isMergeEligible(path: string, size: number): boolean {
  if (size > maxMergeEligibleSize) {
    return false;
  }
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext && mergeEligibleExtensions.has(ext)) {
    return true;
  }
  return mime.getType(path)?.startsWith("text/") ?? false;
}

// In practice this is the lastModified timestamp
type SyncHash = number;

// Tuple where the first value represents a lastModified timestamp for the primary space
// and the second item the lastModified value of the secondary space
export type SyncStatusItem = [SyncHash, SyncHash];

export class SyncSnapshot {
  constructor(
    public files: Map<string, SyncStatusItem> = new Map(),
    public nonSyncedFiles: Map<string, FileMeta> = new Map(),
    // Last known revision hash of the secondary (remote) copy of each synced
    // file, used to send conditional write/delete preconditions.
    public remoteHashes: Map<string, string> = new Map(),
    // Hash of the last common base content for each synced file, used for
    // three-way reconciliation.
    public baseHashes: Map<string, string> = new Map(),
  ) {
    this.files = files;
    this.nonSyncedFiles = nonSyncedFiles;
    this.remoteHashes = remoteHashes;
    this.baseHashes = baseHashes;
  }

  toJSON(): any {
    return {
      files: Object.fromEntries(this.files),
      nonSyncedFiles: Object.fromEntries(this.nonSyncedFiles),
      remoteHashes: Object.fromEntries(this.remoteHashes),
      baseHashes: Object.fromEntries(this.baseHashes),
    };
  }

  static fromJSON(json: any | undefined): SyncSnapshot {
    return new SyncSnapshot(
      new Map(Object.entries(json?.files || {})),
      new Map(Object.entries(json?.nonSyncedFiles || {})),
      new Map(Object.entries(json?.remoteHashes || {})),
      new Map(Object.entries(json?.baseHashes || {})),
    );
  }
}

interface ConditionalSecondary {
  writeFileConditional(
    path: string,
    data: Uint8Array,
    meta?: FileMeta,
    precondition?: WritePrecondition,
  ): Promise<{ meta: FileMeta; remoteHash?: string }>;
  readFileWithHash(
    path: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta; remoteHash?: string }>;
  deleteFileConditional(path: string, expectedHash?: string): Promise<void>;
}

function asConditional(
  secondary: SpacePrimitives,
): ConditionalSecondary | undefined {
  if (typeof (secondary as any).writeFileConditional === "function") {
    return secondary as unknown as ConditionalSecondary;
  }
  return undefined;
}

async function pushToSecondary(
  secondary: SpacePrimitives,
  snapshot: SyncSnapshot,
  path: string,
  data: Uint8Array,
  meta: FileMeta | undefined,
  precondition: WritePrecondition | undefined,
): Promise<FileMeta> {
  const conditional = asConditional(secondary);
  if (!conditional) {
    return secondary.writeFile(path, data, meta);
  }
  const { meta: writtenMeta, remoteHash } =
    await conditional.writeFileConditional(path, data, meta, precondition);
  if (remoteHash) {
    snapshot.remoteHashes.set(path, remoteHash);
  } else {
    snapshot.remoteHashes.delete(path);
  }
  return writtenMeta;
}

async function readFromSecondary(
  secondary: SpacePrimitives,
  snapshot: SyncSnapshot,
  path: string,
): Promise<{ data: Uint8Array; meta: FileMeta; remoteHash?: string }> {
  const conditional = asConditional(secondary);
  if (!conditional) {
    return secondary.readFile(path);
  }
  const { data, meta, remoteHash } = await conditional.readFileWithHash(path);
  if (remoteHash) {
    snapshot.remoteHashes.set(path, remoteHash);
  }
  return { data, meta, remoteHash };
}

/**
 * The local state a pull decision was based on, re-checked immediately before
 * the pulled bytes are written over the local copy.
 */
type ExpectedLocal =
  | { type: "absent" }
  | { type: "unchanged"; lastModified: number };

/**
 * What an explicit dirty-path signal says about a path. A signal means
 * "something really happened here", which is worth one content verification
 * when the millisecond timestamps then classify the path as unchanged.
 */
export type SyncSignal =
  // Nothing was signalled: a periodic scan, or a caller with no origin
  // information. Classification is trusted as-is.
  | { type: "unknown" }
  // Something happened to this path, with no revision to name it by.
  | { type: "changed" }
  // A remote change event reporting the revision the remote now holds
  // (the `/.events` payload's `revision.hash`).
  | { type: "remoteRevision"; hash: string };

/**
 * Which side of a signalled path actually moved, once its content was
 * compared against the revision this replica last synced.
 */
type Divergence = "none" | "local" | "remote" | "both";

type RemoteRevision =
  | { type: "known"; hash: string }
  // The remote has no copy of this path.
  | { type: "absent" }
  // The remote isn't known to report revisions (pre-revision server, a proxy
  // stripping ETags), so no precondition can be stated.
  | { type: "unknown" };

/**
 * The remote revision to condition a mutation on. A recorded hash is used
 * as-is; with nothing recorded but the remote known to report revisions (any
 * hash recorded at all), the current revision is read and recorded first so
 * the mutation still states what it expects. That read narrows the window
 * rather than closing it — a 412 still routes through the conflict machinery.
 */
async function remoteRevision(
  secondary: SpacePrimitives,
  snapshot: SyncSnapshot,
  path: string,
): Promise<RemoteRevision> {
  const recorded = snapshot.remoteHashes.get(path);
  if (recorded) {
    return { type: "known", hash: recorded };
  }
  const conditional = asConditional(secondary);
  if (!conditional || snapshot.remoteHashes.size === 0) {
    return { type: "unknown" };
  }
  let remoteHash: string | undefined;
  try {
    ({ remoteHash } = await conditional.readFileWithHash(path));
  } catch (e: any) {
    if (e.message === notFoundError.message) {
      return { type: "absent" };
    }
    throw e;
  }
  if (!remoteHash) {
    return { type: "unknown" };
  }
  console.log("[sync]", "No recorded revision, read one before mutating", path);
  snapshot.remoteHashes.set(path, remoteHash);
  return { type: "known", hash: remoteHash };
}

async function pushPrecondition(
  secondary: SpacePrimitives,
  snapshot: SyncSnapshot,
  path: string,
): Promise<WritePrecondition | undefined> {
  const revision = await remoteRevision(secondary, snapshot, path);
  switch (revision.type) {
    case "known":
      return { type: "matchesHash", hash: revision.hash };
    case "absent":
      return { type: "notExists" };
    case "unknown":
      return undefined;
  }
}

async function deleteFromSecondary(
  secondary: SpacePrimitives,
  snapshot: SyncSnapshot,
  path: string,
): Promise<void> {
  const conditional = asConditional(secondary);
  if (!conditional) {
    await secondary.deleteFile(path);
    return;
  }
  const revision = await remoteRevision(secondary, snapshot, path);
  if (revision.type === "absent") {
    console.log(
      "[sync]",
      "Already gone from secondary, nothing to delete",
      path,
    );
    return;
  }
  await conditional.deleteFileConditional(
    path,
    revision.type === "known" ? revision.hash : undefined,
  );
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
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
  baseStore?: BaseStore;
  onScheduleResync?: (path: string) => void;
};

export type SyncEvents = {
  syncProgress: (
    syncStatus: SyncStatus,
    snapshot: SyncSnapshot,
  ) => void | Promise<void>;
  snapshotUpdated: (snapshot: SyncSnapshot) => void | Promise<void>;
  syncConflict: (path: string) => void | Promise<void>;
  suppressedDeletion: (path: string) => void | Promise<void>;
};

// Implementation of this algorithm: https://unterwaditzer.net/2016/sync-algorithm.html
export class SpaceSync extends EventEmitter<SyncEvents> {
  // Sync mutex (only one sync operation at a time)
  private isSyncing = false;
  // Once the secondary responds with 404/405 to a reconcile request, it's
  // remembered as unsupported for the lifetime of this instance.
  private reconcileUnsupported = false;

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
      sortedPaths.sort((a, b) => {
        // Make sure that plug files appear first
        // This is important for the initial sync: plugs are loaded the moment they are pulled into the space,
        // which would activate e.g. any indexing logic for the remaining space content
        const aIsPlug = a.endsWith(".plug.js") ? 0 : 1;
        const bIsPlug = b.endsWith(".plug.js") ? 0 : 1;
        return aIsPlug - bIsPlug;
      });
      // console.log("[sync]", "Iterating over all files");
      let filesProcessed = 0;
      await processWithConcurrency(
        sortedPaths,
        async (path) => {
          const fileOperations = await this.syncFile(
            path,
            primaryFileMap.get(path),
            secondaryFileMap.get(path),
            !nonSyncCandidates.has(path),
            snapshot,
            { type: "unknown" },
          );
          operations = operations + fileOperations;
          filesProcessed++;
          if (fileOperations > 0) {
            // Only report something significant
            await this.emit(
              "syncProgress",
              {
                filesProcessed,
                totalFiles: sortedPaths.length,
              },
              snapshot,
            );
          }
        },
        syncConcurrency,
      );
      console.log(
        "[Sync]",
        "Completed:",
        operations,
        "operations in",
        `${(Date.now() - startTime) / 1000}s`,
      );
    } finally {
      this.isSyncing = false;
      // Always persist the snapshot, even when operations === 0,
      // because nonSyncedFiles metadata may have been updated
      void this.emit("snapshotUpdated", snapshot);
    }

    return operations;
  }

  /**
   * Syncs a single file — the entry point every explicit dirty-path signal
   * arrives through. `signal` says what the scheduler was told, and is what a
   * "nothing changed here" classification is verified against instead of
   * being trusted.
   * @returns number of operations performed, or -1 when sync was already ongoing
   */
  public async syncSingleFile(
    path: string,
    snapshot: SyncSnapshot,
    signal: SyncSignal = { type: "unknown" },
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
      let primaryMeta: FileMeta | undefined;
      try {
        primaryMeta = await this.primary.getFileMeta(path);
      } catch (e: any) {
        if (e.message === notFoundError.message) {
          // File doesn't exist locally (e.g., was just deleted), that's ok
        } else {
          throw e;
        }
      }
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
        signal,
      );
    } finally {
      this.isSyncing = false;
      if (operations > 0) {
        void this.emit("snapshotUpdated", snapshot);
      }
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
   * @param signal What an explicit dirty-path signal said about this path
   * @returns The number of operations performed
   */
  private async syncFile(
    path: string,
    primaryMeta: FileMeta | undefined,
    secondaryMeta: FileMeta | undefined,
    syncBack: boolean,
    snapshot: SyncSnapshot,
    signal: SyncSignal,
  ): Promise<number> {
    let operations = 0;

    if (
      primaryMeta !== undefined &&
      secondaryMeta === undefined &&
      !snapshot.files.has(path)
    ) {
      // New file, created on primary, copy from primary to secondary
      console.log(
        "[sync]",
        "New file created on primary, copying to secondary",
        path,
      );
      const { data, meta } = await this.primary.readFile(path);
      try {
        const precondition: WritePrecondition | undefined =
          snapshot.remoteHashes.size > 0 ? { type: "notExists" } : undefined;
        const writtenMeta = await pushToSecondary(
          this.secondary,
          snapshot,
          path,
          data,
          meta,
          precondition,
        );
        snapshot.files.set(path, [meta.lastModified, writtenMeta.lastModified]);
        // Let's make sure this file is not marked as nonSynced, because we have a local copy
        snapshot.nonSyncedFiles.delete(path);
        await this.captureBase(path, data, snapshot);
        operations++;
      } catch (e) {
        if (e instanceof PreconditionFailedError) {
          console.warn(
            "[sync]",
            "Precondition failed creating remote file, resolving conflict",
            path,
          );
          operations += await this.callConflictResolver(path, snapshot);
        } else {
          throw e;
        }
      }
    } else if (
      secondaryMeta !== undefined &&
      // Scenario: a new file was created on the secondary
      ((primaryMeta === undefined && !snapshot.files.has(path)) ||
        // Scenario: a file that was previously unsynced, should now be synced
        (snapshot.nonSyncedFiles.has(path) &&
          syncBack &&
          // because we don't have it yet
          primaryMeta === undefined))
    ) {
      // New file to sync, present on secondary
      if (syncBack) {
        // Copy from secondary to primary
        console.log(
          "[sync]",
          "New file to sync on secondary, copying from secondary to primary",
          path,
        );
        const pulled = await this.pullFromSecondary(path, snapshot, {
          type: "absent",
        });
        if (!pulled) {
          return operations;
        }
        // Update file snapshot
        snapshot.files.set(path, [
          pulled.writtenMeta.lastModified,
          pulled.meta.lastModified,
        ]);
        // Make sure the file is not marked as nonSynced anymore
        snapshot.nonSyncedFiles.delete(path);
        await this.captureBase(path, pulled.data, snapshot);
        operations++;
      } else {
        // !syncBack
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
      primaryMeta !== undefined &&
      snapshot.files.has(path) &&
      secondaryMeta === undefined
    ) {
      // File deleted on secondary
      if (syncBack) {
        // A local modification wins over a concurrent remote deletion:
        // recreate the file remotely rather than destroy an edit that was
        // never pushed. A save inside the same millisecond as the recorded
        // revision leaves the timestamps identical, so the local content is
        // what settles it.
        if (
          !snapshot.nonSyncedFiles.has(path) &&
          (primaryMeta.lastModified !== snapshot.files.get(path)![0] ||
            (await this.localDivergedFromRecorded(path, snapshot)))
        ) {
          return await this.recreateOverRemoteDeletion(path, snapshot);
        }
        snapshot.files.delete(path);
        snapshot.remoteHashes.delete(path);
        snapshot.baseHashes.delete(path);
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
      } else {
        // !syncBack
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
        snapshot.remoteHashes.delete(path);
        snapshot.baseHashes.delete(path);
        snapshot.nonSyncedFiles.delete(path);
      }
    } else if (
      // The file is on the secondary, and not on the primary
      secondaryMeta !== undefined &&
      snapshot.files.has(path) &&
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
      try {
        await deleteFromSecondary(this.secondary, snapshot, path);
        snapshot.files.delete(path);
        snapshot.remoteHashes.delete(path);
        snapshot.baseHashes.delete(path);
        snapshot.nonSyncedFiles.delete(path);
        operations++;
      } catch (e) {
        if (e instanceof PreconditionFailedError) {
          console.warn(
            "[sync]",
            "Remote changed since last sync, pulling instead of deleting",
            path,
          );
          const pulled = await this.pullFromSecondary(path, snapshot, {
            type: "absent",
          });
          if (!pulled) {
            return operations;
          }
          snapshot.files.set(path, [
            pulled.writtenMeta.lastModified,
            pulled.meta.lastModified,
          ]);
          snapshot.nonSyncedFiles.delete(path);
          await this.captureBase(path, pulled.data, snapshot);
          void this.emit("suppressedDeletion", path);
          operations++;
        } else {
          throw e;
        }
      }
    } else if (
      snapshot.files.has(path) &&
      primaryMeta === undefined &&
      secondaryMeta === undefined
    ) {
      // File deleted on both sides, :shrug:
      console.log(
        "[sync]",
        "File deleted on both ends, deleting from snapshot",
        path,
      );
      snapshot.files.delete(path);
      snapshot.remoteHashes.delete(path);
      snapshot.baseHashes.delete(path);
      snapshot.nonSyncedFiles.delete(path);
      operations++;
    } else if (
      primaryMeta !== undefined &&
      secondaryMeta !== undefined &&
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
      operations += await this.pushLocalCopy(path, snapshot);
    } else if (
      primaryMeta !== undefined &&
      secondaryMeta !== undefined &&
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
        operations += await this.pullRemoteCopy(
          path,
          snapshot,
          primaryMeta.lastModified,
        );
      } else {
        // !syncBack
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
      // File changed on both ends, but we don't have any info in the snapshot (resync scenario?): have to run through conflict handling
      (primaryMeta !== undefined &&
        secondaryMeta !== undefined &&
        !snapshot.files.has(path)) ||
      // File changed on both ends, CONFLICT!
      (primaryMeta !== undefined &&
        secondaryMeta !== undefined &&
        snapshot.files.get(path) &&
        primaryMeta.lastModified !== snapshot.files.get(path)![0] &&
        secondaryMeta.lastModified !== snapshot.files.get(path)![1])
    ) {
      console.log(
        "[sync]",
        "File changed on both ends, potential conflict",
        path,
      );
      operations += await this.reconcileOrResolve(path, snapshot);
    } else if (primaryMeta && secondaryMeta && !syncBack) {
      console.log(
        "[sync]",
        "File present locally, but no longer synced, deleting local copy of",
        path,
      );
      await this.primary.deleteFile(path);
      snapshot.nonSyncedFiles.set(path, secondaryMeta);
      operations += 1;
    } else if (
      primaryMeta &&
      secondaryMeta &&
      snapshot.files.has(path) &&
      primaryMeta.size !== secondaryMeta.size
    ) {
      // Sizes differ despite matching timestamps — silent content change
      // (e.g. file truncated without mtime update). Treat as conflict.
      console.warn(
        "[sync]",
        `Size mismatch despite matching timestamps (${primaryMeta.size} vs ${secondaryMeta.size} bytes), forcing conflict resolution:`,
        path,
      );
      operations += await this.reconcileOrResolve(path, snapshot);
    } else if (
      primaryMeta &&
      secondaryMeta &&
      snapshot.files.has(path) &&
      syncBack
    ) {
      // Timestamps and sizes both match, which is all the millisecond
      // resolution scan can tell. If something explicitly signalled this
      // path, that classification is verified against content once rather
      // than trusted.
      switch (await this.classifySignalled(path, snapshot, signal)) {
        case "none":
          break;
        case "local":
          console.log(
            "[sync]",
            "Signalled path differs locally despite matching timestamps, pushing",
            path,
          );
          operations += await this.pushLocalCopy(path, snapshot);
          break;
        case "remote":
          console.log(
            "[sync]",
            "Signalled path holds another remote revision despite matching timestamps, pulling",
            path,
          );
          operations += await this.pullRemoteCopy(
            path,
            snapshot,
            primaryMeta.lastModified,
          );
          break;
        case "both":
          console.log(
            "[sync]",
            "Signalled path differs on both ends despite matching timestamps, resolving",
            path,
          );
          operations += await this.reconcileOrResolve(path, snapshot);
          break;
      }
    } else {
      // Nothing needs to happen
      if (!syncBack && secondaryMeta) {
        snapshot.nonSyncedFiles.set(path, secondaryMeta);
      }
    }
    // End scene
    return operations;
  }

  /**
   * Adopt the local copy as the new remote revision (the "changed on primary"
   * scenario). A 412 means the remote moved since the recorded revision,
   * which routes through reconciliation rather than overwriting it.
   */
  private async pushLocalCopy(
    path: string,
    snapshot: SyncSnapshot,
  ): Promise<number> {
    const { data, meta } = await this.primary.readFile(path);
    try {
      const precondition = await pushPrecondition(
        this.secondary,
        snapshot,
        path,
      );
      const writtenMeta = await pushToSecondary(
        this.secondary,
        snapshot,
        path,
        data,
        meta,
        precondition,
      );
      snapshot.files.set(path, [meta.lastModified, writtenMeta.lastModified]);
      // Delete from non-synced files just in case, because we clearly have a local copy
      snapshot.nonSyncedFiles.delete(path);
      await this.captureBase(path, data, snapshot);
      return 1;
    } catch (e) {
      if (e instanceof PreconditionFailedError) {
        console.warn(
          "[sync]",
          "Precondition failed pushing changed file, resolving conflict",
          path,
        );
        return await this.reconcileOrResolve(path, snapshot);
      }
      throw e;
    }
  }

  /**
   * Adopt the remote revision over the local copy (the "changed on secondary"
   * scenario), through the guarded pull. An abandoned pull reports 0
   * operations and leaves the snapshot stale on purpose.
   */
  private async pullRemoteCopy(
    path: string,
    snapshot: SyncSnapshot,
    localLastModified: number,
  ): Promise<number> {
    // "The local copy didn't change" came from a millisecond timestamp, which
    // a save landing in the same millisecond as the recorded one defeats. The
    // local bytes have to be read for the pull guard anyway, so they answer
    // it properly: a copy that no longer hashes to the revision this replica
    // last synced holds an edit nobody has seen, and adopting the remote
    // revision over it would destroy it.
    if (await this.localDivergedFromRecorded(path, snapshot)) {
      console.log(
        "[sync]",
        "Local copy holds an unsynced edit despite an unchanged timestamp, resolving instead of pulling",
        path,
      );
      return await this.reconcileOrResolve(path, snapshot);
    }
    const pulled = await this.pullFromSecondary(path, snapshot, {
      type: "unchanged",
      lastModified: localLastModified,
    });
    if (!pulled) {
      return 0;
    }
    snapshot.files.set(path, [
      pulled.writtenMeta.lastModified,
      pulled.meta.lastModified,
    ]);
    // Make sure it's not in nonSyncedFiles
    snapshot.nonSyncedFiles.delete(path);
    await this.captureBase(path, pulled.data, snapshot);
    return 1;
  }

  /**
   * Three-way reconciliation where it applies, the legacy conflict resolver
   * otherwise.
   */
  private async reconcileOrResolve(
    path: string,
    snapshot: SyncSnapshot,
  ): Promise<number> {
    const reconciled = await this.tryReconcile(path, snapshot);
    return reconciled !== null
      ? reconciled
      : await this.callConflictResolver(path, snapshot);
  }

  /**
   * Whether the local copy still holds the revision this replica last synced.
   * `false` whenever there's nothing to compare against (no recorded
   * revision, no local copy), which leaves the caller's own classification
   * standing.
   */
  private async localDivergedFromRecorded(
    path: string,
    snapshot: SyncSnapshot,
  ): Promise<boolean> {
    const recorded = snapshot.remoteHashes.get(path);
    if (!recorded) {
      return false;
    }
    const local = await this.readLocal(path);
    return local !== undefined && (await hashSHA256(local)) !== recorded;
  }

  /**
   * One content verification for a path an explicit signal flagged and the
   * millisecond timestamps then called unchanged. Two writes to the same path
   * in the same millisecond with the same byte length are indistinguishable
   * to the scan, so the recorded revision hash — the bytes this replica last
   * agreed with the remote on — decides instead: local content that no longer
   * hashes to it moved, and a signal reporting another remote revision says
   * the remote moved.
   *
   * Costs one local read, and no network round trip beyond the one
   * `remoteRevision` already makes for an unrecorded path.
   */
  private async classifySignalled(
    path: string,
    snapshot: SyncSnapshot,
    signal: SyncSignal,
  ): Promise<Divergence> {
    if (signal.type === "unknown") {
      return "none";
    }
    const local = await this.readLocal(path);
    if (local === undefined) {
      return "none";
    }
    const localHash = await hashSHA256(local);

    const recorded = snapshot.remoteHashes.get(path);
    if (!recorded) {
      // Nothing recorded: the current remote revision (read and recorded
      // here) is no baseline to attribute a change to, so a difference only
      // says the two sides disagree.
      const revision = await remoteRevision(this.secondary, snapshot, path);
      return revision.type === "known" && revision.hash !== localHash
        ? "both"
        : "none";
    }

    const localChanged = localHash !== recorded;
    const remoteChanged =
      signal.type === "remoteRevision" && signal.hash !== recorded;
    if (localChanged && remoteChanged) {
      return "both";
    }
    if (localChanged) {
      return "local";
    }
    return remoteChanged ? "remote" : "none";
  }

  /**
   * Push a local edit back over a remote deletion (the "file deleted on
   * secondary" scenario's modification-wins branch). The remote copy is
   * gone, so the write is a conditional create; a 412 means it reappeared
   * mid-flight, which the next cycle resolves through the normal decision
   * tree.
   */
  private async recreateOverRemoteDeletion(
    path: string,
    snapshot: SyncSnapshot,
  ): Promise<number> {
    console.log(
      "[sync]",
      "File deleted on secondary but modified locally, recreating remotely",
      path,
    );
    const { data, meta } = await this.primary.readFile(path);
    try {
      const precondition: WritePrecondition | undefined =
        snapshot.remoteHashes.size > 0 ? { type: "notExists" } : undefined;
      const writtenMeta = await pushToSecondary(
        this.secondary,
        snapshot,
        path,
        data,
        meta,
        precondition,
      );
      snapshot.files.set(path, [meta.lastModified, writtenMeta.lastModified]);
      snapshot.nonSyncedFiles.delete(path);
      await this.captureBase(path, data, snapshot);
      void this.emit("suppressedDeletion", path);
    } catch (e) {
      if (e instanceof PreconditionFailedError) {
        console.warn(
          "[sync]",
          "File reappeared remotely mid-recreate, re-syncing",
          path,
        );
        this.options.onScheduleResync?.(path);
      } else {
        throw e;
      }
    }
    return 1;
  }

  /**
   * Read `path` from the secondary and adopt it over the local copy.
   *
   * The decision to pull was made from local state read earlier in the cycle,
   * and the remote read that follows takes a full round trip. A local save
   * landing in that window would be overwritten without a trace, so the local
   * copy is re-read immediately before the write and compared *by content*
   * against what it held going in — timestamps and sizes both repeat too
   * easily to decide this on. If it advanced, the pulled bytes are dropped,
   * the path is re-marked for sync, and the snapshot is left stale so the
   * next cycle sees both sides changed and reconciles. `null` reports that
   * abandoned pull.
   */
  private async pullFromSecondary(
    path: string,
    snapshot: SyncSnapshot,
    expected: ExpectedLocal,
  ): Promise<{
    data: Uint8Array;
    meta: FileMeta;
    writtenMeta: FileMeta;
  } | null> {
    const priorRemoteHash = snapshot.remoteHashes.get(path);
    const before = await this.readLocal(path);
    const { data, meta } = await readFromSecondary(
      this.secondary,
      snapshot,
      path,
    );

    if (before) {
      await this.captureSafety(path, before, data, snapshot);
    }

    // Content across the remote read, metadata against what the cycle
    // classified: the two windows they cover don't overlap.
    const current = await this.readLocal(path);
    const contentHeld =
      before === undefined
        ? current === undefined
        : current !== undefined && bytesEqual(current, before);
    if (!contentHeld || !(await this.localStillExpected(path, expected))) {
      console.warn(
        "[sync]",
        "Local copy changed mid-pull, not overwriting it",
        path,
      );
      // The revision read above was never adopted, so it must not be left
      // recorded as one this replica holds: it would arm a destructive push
      // next cycle instead of the reconciliation the stale state produces.
      if (priorRemoteHash === undefined) {
        snapshot.remoteHashes.delete(path);
      } else {
        snapshot.remoteHashes.set(path, priorRemoteHash);
      }
      this.options.onScheduleResync?.(path);
      return null;
    }

    const writtenMeta = await this.primary.writeFile(path, data, meta);
    return { data, meta, writtenMeta };
  }

  private async readLocal(path: string): Promise<Uint8Array | undefined> {
    try {
      const { data } = await this.primary.readFile(path);
      return data;
    } catch (e: any) {
      if (e.message !== notFoundError.message) {
        throw e;
      }
      return undefined;
    }
  }

  private async localStillExpected(
    path: string,
    expected: ExpectedLocal,
  ): Promise<boolean> {
    let current: FileMeta | undefined;
    try {
      current = await this.primary.getFileMeta(path);
    } catch (e: any) {
      if (e.message !== notFoundError.message) {
        throw e;
      }
    }
    return expected.type === "absent"
      ? current === undefined
      : current?.lastModified === expected.lastModified;
  }

  /**
   * Keep a recoverable copy of the local bytes `incoming` is about to
   * replace, unless they are the merge base both sides already agree on
   * (nothing of the user's is being displaced then).
   */
  private async captureSafety(
    path: string,
    local: Uint8Array,
    incoming: Uint8Array,
    snapshot: SyncSnapshot,
  ): Promise<void> {
    const baseStore = this.options.baseStore;
    if (!baseStore) {
      return;
    }
    if (
      !isMergeEligible(path, local.byteLength) ||
      bytesEqual(local, incoming)
    ) {
      return;
    }
    if ((await hashSHA256(local)) === snapshot.baseHashes.get(path)) {
      return;
    }
    try {
      await baseStore.putSafety(local);
    } catch (e) {
      console.warn("[sync]", "Could not store safety copy for", path, e);
    }
  }

  private async captureBase(
    path: string,
    data: Uint8Array,
    snapshot: SyncSnapshot,
  ): Promise<void> {
    if (!this.options.baseStore || !isMergeEligible(path, data.byteLength)) {
      return;
    }
    const hash = await this.options.baseStore.putBase(data);
    snapshot.baseHashes.set(path, hash);
  }

  private async callConflictResolver(
    path: string,
    snapshot: SyncSnapshot,
  ): Promise<number> {
    const ops = await this.options.conflictResolver(
      path,
      snapshot,
      this.primary,
      this.secondary,
    );
    // A resolver that dropped the snapshot entry deferred instead of
    // resolving (either side changed mid-resolution), so the two sides do
    // not hold identical bytes and there is no common base to capture.
    if (!snapshot.files.has(path)) {
      return ops;
    }
    // Otherwise (byte-match no-op, primary-wins conflict copy, stdLib
    // server-wins) primary and secondary now hold identical canonical bytes
    // for this path, so it's safe to capture a base from what's on primary.
    try {
      const { data } = await this.primary.readFile(path);
      await this.captureBase(path, data, snapshot);
    } catch {
      // No local copy to capture a base from
    }
    return ops;
  }

  /**
   * Attempts server-side three-way reconciliation for a path that just hit
   * a write conflict. Returns null when reconciliation isn't applicable
   * (caller should fall back to options.conflictResolver), or the number
   * of operations performed.
   */
  private async tryReconcile(
    path: string,
    snapshot: SyncSnapshot,
  ): Promise<number | null> {
    const baseStore = this.options.baseStore;
    if (!baseStore || this.reconcileUnsupported) {
      return null;
    }
    if (path.startsWith(stdLibPrefix)) {
      return null;
    }
    const secondaryAny = this.secondary as any;
    if (typeof secondaryAny.reconcile !== "function") {
      return null;
    }
    const baseHash = snapshot.baseHashes.get(path);
    if (!baseHash) {
      return null;
    }
    const baseBytes = await baseStore.getBase(baseHash);
    if (!baseBytes) {
      return null;
    }

    let proposedData: Uint8Array;
    try {
      ({ data: proposedData } = await this.primary.readFile(path));
    } catch {
      return null;
    }

    if (
      !isMergeEligible(path, baseBytes.byteLength) ||
      !isMergeEligible(path, proposedData.byteLength)
    ) {
      return null;
    }

    const decoder = new TextDecoder("utf-8", { fatal: true });
    let baseText: string;
    let proposedText: string;
    try {
      baseText = decoder.decode(baseBytes);
      proposedText = decoder.decode(proposedData);
    } catch {
      return null;
    }

    const proposedHash = await hashSHA256(proposedData);
    const request: ReconcileRequest = {
      baseHash,
      baseText,
      proposedHash,
      proposedText,
      source: "sync",
    };

    let response: ReconcileResponse | null;
    try {
      response = await secondaryAny.reconcile(path, request);
    } catch {
      // Any reconcile error other than a clean "unsupported" (null) response
      // falls back to the legacy conflict resolver without latching
      // reconcileUnsupported — a transient failure (network error, 409/413,
      // 400, 5xx) must not disable reconciliation for the rest of the session.
      return null;
    }

    if (response === null) {
      this.reconcileUnsupported = true;
      return null;
    }

    if (response.status === "conflicted") {
      void this.emit("syncConflict", path);
    }

    if (response.status === "retry") {
      // The churn revision goes unrecorded: remoteHashes only ever holds
      // revisions this replica has held.
      this.options.onScheduleResync?.(path);
      return 1;
    }

    let currentData: Uint8Array;
    let currentMeta: FileMeta;
    try {
      ({ data: currentData, meta: currentMeta } =
        await this.primary.readFile(path));
    } catch (e: any) {
      if (e.message === notFoundError.message) {
        // Local file was deleted mid-flight; the proposal is no longer
        // current. Treat exactly like "local advanced": don't apply, and
        // let the next cycle's delete-vs-edit rule converge it.
        return this.localAdvanced(
          path,
          snapshot,
          baseStore,
          proposedData,
          proposedHash,
        );
      }
      // Any other read failure (transient I/O/storage error) is not
      // "the file is gone" — propagate it rather than silently mutating
      // baseHashes/remoteHashes on bad information.
      throw e;
    }
    const currentHash = await hashSHA256(currentData);

    if (currentHash !== proposedHash) {
      // Local content advanced again while reconciliation was in flight;
      // don't clobber it. Record what we proposed as the new base and
      // let the next cycle reconcile again with fresh state.
      return this.localAdvanced(
        path,
        snapshot,
        baseStore,
        proposedData,
        proposedHash,
      );
    }

    const resultBytes = new TextEncoder().encode(response.text);
    const resultHash = await hashSHA256(resultBytes);
    if (proposedHash !== baseHash && proposedHash !== resultHash) {
      try {
        await baseStore.putSafety(proposedData);
      } catch (e) {
        console.warn("[sync]", "Could not store safety copy for", path, e);
      }
    }

    const meta: FileMeta = {
      ...currentMeta,
      lastModified: response.revision.lastModified,
      size: resultBytes.byteLength,
    };
    await this.primary.writeFile(path, resultBytes, meta);

    snapshot.files.set(path, [
      response.revision.lastModified,
      response.revision.lastModified,
    ]);
    snapshot.remoteHashes.set(path, response.revision.hash);
    try {
      await baseStore.putBase(resultBytes);
    } catch (e) {
      console.warn("[sync]", "Could not store merge base for", path, e);
    }
    snapshot.baseHashes.set(path, resultHash);

    return 1;
  }

  /**
   * The proposal we submitted is no longer what's on primary — either the
   * file changed again in flight, or it was deleted outright. Don't apply
   * the reconciliation result; record what we proposed as the new base and
   * let the next cycle reconcile (or delete-vs-edit) with fresh state.
   */
  private async localAdvanced(
    path: string,
    snapshot: SyncSnapshot,
    baseStore: BaseStore,
    proposedData: Uint8Array,
    proposedHash: string,
  ): Promise<number> {
    snapshot.baseHashes.set(path, proposedHash);
    await baseStore.putBase(proposedData);
    // The files entry and remoteHashes stay untouched: remoteHashes only ever
    // holds revisions this replica has held, and recording an unseen one would
    // arm a destructive delete or push next cycle instead of the follow-up
    // reconciliation the stale state produces.
    this.options.onScheduleResync?.(path);
    // Returning 1 (not 0) ensures the caller's operations count is > 0, so
    // syncSingleFile persists the updated snapshot instead of leaving the
    // new baseHashes entry stranded in memory only.
    return 1;
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
    const pageData2 = await readFromSecondary(secondary, snapshot, path);

    if (bytesEqual(pageData1.data, pageData2.data)) {
      console.log("[sync]", "Files are the same, no conflict");

      snapshot.files.set(path, [
        pageData1.meta.lastModified,
        pageData2.meta.lastModified,
      ]);
      return 0;
    }

    let operations = 0;
    // Named after the losing (secondary) revision's bytes: content-addressed,
    // so re-resolving the same conflict is idempotent.
    const hash8 = (await hashSHA256(pageData2.data)).slice(0, 8);
    const revisionFileName =
      filePieces.length === 1
        ? `${path}.conflicted-${hash8}`
        : `${fileNameBase}.conflicted-${hash8}.${fileNameExt}`;

    // The name is content-addressed, so a side that already has it already
    // holds this exact losing revision. Each side is checked separately: a
    // copy present on one is no evidence about the other.
    const holdsCopy = async (space: SpacePrimitives): Promise<boolean> => {
      try {
        await space.getFileMeta(revisionFileName);
        return true;
      } catch (e: any) {
        if (e.message !== notFoundError.message) {
          throw e;
        }
        return false;
      }
    };
    const onPrimary = await holdsCopy(primary);
    const onSecondary = await holdsCopy(secondary);

    if (onPrimary && onSecondary) {
      console.log(
        "[sync]",
        "Conflict copy already exists, skipping",
        revisionFileName,
      );
    } else {
      let localConflictMeta: FileMeta;
      if (onPrimary) {
        localConflictMeta = await primary.getFileMeta(revisionFileName);
      } else {
        console.log(
          "[sync]",
          "Creating conflict copy on primary",
          revisionFileName,
        );
        localConflictMeta = await primary.writeFile(
          revisionFileName,
          pageData2.data,
        );
        operations++;
      }

      let remoteConflictMeta: FileMeta;
      if (onSecondary) {
        remoteConflictMeta = await secondary.getFileMeta(revisionFileName);
      } else {
        console.log(
          "[sync]",
          "Creating conflict copy on secondary",
          revisionFileName,
        );
        remoteConflictMeta = await pushToSecondary(
          secondary,
          snapshot,
          revisionFileName,
          pageData2.data,
          undefined,
          undefined,
        );
        operations++;
      }

      snapshot.files.set(revisionFileName, [
        localConflictMeta.lastModified,
        remoteConflictMeta.lastModified,
      ]);
    }

    // pageData1 was read before the conflict copies were written; a local edit
    // since then must not be overwritten by pushing the stale bytes.
    let currentLocal: Uint8Array | undefined;
    try {
      ({ data: currentLocal } = await primary.readFile(path));
    } catch (e: any) {
      if (e.message !== notFoundError.message) {
        throw e;
      }
    }
    if (!currentLocal || !bytesEqual(currentLocal, pageData1.data)) {
      console.log(
        "[sync]",
        "Local copy changed during conflict resolution, deferring",
        path,
      );
      snapshot.files.delete(path);
      return operations;
    }

    // Write replacement on top (primary wins), conditional on the revision
    // this resolution actually inspected.
    let writeMeta: FileMeta;
    try {
      writeMeta = await pushToSecondary(
        secondary,
        snapshot,
        path,
        pageData1.data,
        undefined,
        pageData2.remoteHash
          ? { type: "matchesHash", hash: pageData2.remoteHash }
          : undefined,
      );
    } catch (e) {
      if (e instanceof PreconditionFailedError) {
        console.warn(
          "[sync]",
          "Remote changed during conflict resolution, deferring",
          path,
        );
        snapshot.files.delete(path);
        snapshot.remoteHashes.delete(path);
        return operations;
      }
      throw e;
    }
    operations++;

    snapshot.files.set(path, [
      pageData1.meta.lastModified,
      writeMeta.lastModified,
    ]);
    return operations;
  }
}
