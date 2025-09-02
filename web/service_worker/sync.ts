import { notFoundError } from "../../lib/constants.ts";
import type { DataStore } from "../../lib/data/datastore.ts";
import { EventEmitter } from "../../lib/plugos/event.ts";
import { plugPrefix, stdLibPrefix } from "../../lib/spaces/constants.ts";
import type { SpacePrimitives } from "../../lib/spaces/space_primitives.ts";
import { SpaceSync, type SyncStatusItem } from "../../lib/spaces/sync.ts";

const syncSnapshotKey = ["$syncSnapshot"];
const syncInterval = 10 * 1000;

type SyncEngineEvents = {
  spaceSyncComplete: (operations: number) => void;
  syncError: (error: Error) => void;
  syncConflict: (path: string) => void;
  fileSyncComplete: (path: string) => void;
};

export class SyncEngine extends EventEmitter<SyncEngineEvents> {
  isSyncing = false;

  // Time of last sync start
  syncStart: number | null = null;
  spaceSync: SpaceSync;

  constructor(
    private ds: DataStore,
    readonly local: SpacePrimitives,
    readonly remote: SpacePrimitives,
  ) {
    super();
    this.spaceSync = new SpaceSync(local, remote, {
      conflictResolver: this.plugAwareConflictResolver.bind(this),
      onSyncProgress: (status) => {
        console.log("[Sync] Sync progress", status);
      },
    });
  }

  start() {
    setInterval(() => {
      this.syncSpace().catch((err) => {
        console.error("Sync error", err);
      });
    }, syncInterval);
    this.syncSpace().catch((err) => {
      console.error("Sync error", err);
    });
  }

  isSyncCandidate(_path: string): boolean {
    return true;
  }

  async syncSpace() {
    if (this.isSyncing) {
      console.log("Aborting space sync: already syncing");
      return -1;
    }
    this.syncStart = Date.now();
    let operations = 0;
    const snapshot = await this.getSnapshot();
    try {
      operations = await this.spaceSync.syncFiles(
        snapshot,
        this.isSyncCandidate.bind(this),
      );
      await this.saveSnapshot(snapshot);
      this.emit("spaceSyncComplete", operations);
    } catch (e: any) {
      console.error("Sync error", e.message);
    } finally {
      await this.saveSnapshot(snapshot);
      this.syncStart = null;
    }
    return operations;
  }

  async syncFile(path: string) {
    if (this.isSyncing) {
      console.log("Aborting file sync (already syncing)", path);
      return;
    }
    this.isSyncing = true;
    const snapshot = await this.getSnapshot();
    try {
      let localHash: number | undefined;
      let remoteHash: number | undefined;

      // Fetch remote first (potentially more laggy)
      try {
        remoteHash = (await this.remote.getFileMeta(path)).lastModified;
        if (!remoteHash) {
          console.info(
            "Not syncing file, because remote didn't send X-Last-Modified header",
          );
          // This happens when the remote isn't a real SilverBullet server, specifically: it's not sending
          // a X-Last-Modified header. In this case we'll just assume that the file is up to date.
          return;
        }
      } catch (e: any) {
        if (e.message === notFoundError.message) {
          // File doesn't exist remotely, that's ok
        } else {
          throw e;
        }
      }

      // Fetch local file meta
      try {
        const localMeta = await this.local.getFileMeta(path);
        localHash = localMeta.lastModified;
      } catch {
        // Not present
      }

      await this.spaceSync.syncFile(snapshot, path, localHash, remoteHash);
      this.emit("fileSyncComplete", path);
    } catch (e: any) {
      this.emit("syncError", e);
      console.error("Sync error", e);
    } finally {
      this.isSyncing = false;
    }
  }

  async getSnapshot() {
    return new Map<string, SyncStatusItem>(
      Object.entries(await this.ds.get(syncSnapshotKey) || {}),
    );
  }

  saveSnapshot(snapshot: Map<string, SyncStatusItem>) {
    return this.ds.set(syncSnapshotKey, Object.fromEntries(snapshot));
  }

  async plugAwareConflictResolver(
    name: string,
    snapshot: Map<string, SyncStatusItem>,
    primary: SpacePrimitives,
    secondary: SpacePrimitives,
  ): Promise<number> {
    if (!name.startsWith(plugPrefix) && !name.startsWith(stdLibPrefix)) {
      const operations = await SpaceSync.primaryConflictResolver(
        name,
        snapshot,
        primary,
        secondary,
      );

      if (operations > 0) {
        // Something happened -> conflict copy generated, let's report it
        this.emit("syncConflict", name);
      }

      return operations;
    }
    console.log(
      "[sync]",
      "Conflict in plug",
      name,
      "will pick the version from secondary and be done with it.",
    );
    // Read file from secondary
    const { data, meta } = await secondary.readFile(
      name,
    );
    // Write file to primary
    const newMeta = await primary.writeFile(
      name,
      data,
      false,
      meta,
    );
    // Update snapshot
    snapshot.set(name, [
      newMeta.lastModified,
      meta.lastModified,
    ]);

    return 1;
  }
}
