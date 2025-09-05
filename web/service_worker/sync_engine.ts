import type { KvPrimitives } from "../../lib/data/kv_primitives.ts";
import { EventEmitter } from "../../lib/plugos/event.ts";
import { plugPrefix, stdLibPrefix } from "../../lib/spaces/constants.ts";
import type { SpacePrimitives } from "../../lib/spaces/space_primitives.ts";
import {
  SpaceSync,
  type SyncStatus,
  type SyncStatusItem,
} from "../../lib/spaces/sync.ts";
import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";

const syncSnapshotKey = ["$syncSnapshot"];
const syncInterval = 20 * 1000;

type SyncEngineEvents = {
  // Full sync cycle has completed
  spaceSyncComplete: (operations: number) => void | Promise<void>;

  fileSyncComplete: (path: string, operations: number) => void | Promise<void>;

  syncError: (error: Error) => void | Promise<void>;

  // Sync conflict occurred
  syncConflict: (path: string) => void | Promise<void>;

  // Sync progress updated
  syncProgress: (syncStatus: SyncStatus) => void | Promise<void>;
};

/**
 * Thin wrapper around SpaceSync, adds snapshot persistence and a few other things
 */
export class SyncEngine extends EventEmitter<SyncEngineEvents> {
  spaceSync!: SpaceSync;

  // Snapshot of meta data on non-synced files to be used by the ProxyRouter
  public nonSyncedFiles = new Map<string, FileMeta>();
  syncInterval?: number;

  constructor(
    private kv: KvPrimitives,
    readonly local: SpacePrimitives,
    readonly remote: SpacePrimitives,
  ) {
    super();
  }

  async start() {
    const initialSnapshot = await this.loadSnapshot();

    this.spaceSync = new SpaceSync(this.local, this.remote, initialSnapshot, {
      conflictResolver: this.plugAwareConflictResolver.bind(this),
      isSyncCandidate: this.isSyncCandidate.bind(this),
    });

    this.spaceSync.on({
      syncProgress: (status) => {
        this.emit("syncProgress", status);
      },
      snapshotUpdated: this.saveSnapshot.bind(this),
    });
    this.syncInterval = setInterval(() => {
      this.syncSpace().catch((err) => {
        console.error("Sync error", err);
      });
    }, syncInterval);
    this.syncSpace().catch((err) => {
      console.error("Sync error", err);
    });
  }

  isSyncCandidate(_path: string): boolean {
    // TODO: Replace with actual filter
    // Note: should always include everything starting with _plug/
    return true;
  }

  async syncSpace(): Promise<number> {
    try {
      const { operations, nonSyncedFiles } = await this.spaceSync.syncFiles();
      this.nonSyncedFiles = nonSyncedFiles;
      this.emit("spaceSyncComplete", operations);
      return operations;
    } catch (e) {
      this.emit("syncError", e);
      throw e;
    }
  }

  async syncSingleFile(path: string): Promise<number> {
    try {
      const operations = await this.spaceSync.syncSingleFile(path);
      this.emit("fileSyncComplete", path, operations);
      return operations;
    } catch (e) {
      this.emit("syncError", e);
      throw e;
    }
  }

  /**
   * Loads the sync snapshot from the data store.
   * @returns A map of sync status items.
   */
  async loadSnapshot() {
    const [snapshot] = await this.kv.batchGet([syncSnapshotKey]);
    return new Map<string, SyncStatusItem>(
      Object.entries(snapshot || {}),
    );
  }

  /**
   * Saves the sync snapshot to the data store.
   * @param snapshot A map of sync status items.
   */
  saveSnapshot(snapshot: Map<string, SyncStatusItem>) {
    return this.kv.batchSet([{
      key: syncSnapshotKey,
      value: Object.fromEntries(snapshot),
    }]);
  }

  async wipe() {
    clearInterval(this.syncInterval);
    console.log("Wiping sync database");
    await this.kv.clear();
    console.log("Done wiping");
  }

  /**
   * Delegates to the standard primary conflict resolver, but in case of any conflicts in plugs, it will always take the version from the secondary.
   */
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
