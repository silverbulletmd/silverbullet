import { compile as gitIgnoreCompiler } from "gitignore-parser";
import { jitter, sleep } from "@silverbulletmd/silverbullet/lib/async";
import type { KvPrimitives } from "../data/kv_primitives.ts";
import { EventEmitter } from "../plugos/event.ts";
import { plugPrefix, stdLibPrefix } from "../spaces/constants.ts";
import type { SpacePrimitives } from "../spaces/space_primitives.ts";
import { SpaceSync, SyncSnapshot, type SyncStatus } from "../spaces/sync.ts";
import { HttpSpacePrimitives } from "../spaces/http_space_primitives.ts";

const syncSnapshotKey = ["$sync", "snapshot"];
const syncInterval = 20;

type SyncEngineEvents = {
  // Full sync cycle has completed
  spaceSyncComplete: (operations: number) => void | Promise<void>;

  // A single file syncle has completed
  fileSyncComplete: (path: string, operations: number) => void | Promise<void>;

  syncError: (error: Error) => void | Promise<void>;

  // Sync conflict occurred
  syncConflict: (path: string) => void | Promise<void>;

  // Sync progress updated
  syncProgress: (syncStatus: SyncStatus) => void | Promise<void>;
};

export type SyncConfig = {
  syncDocuments?: boolean;
  syncIgnore?: string;
};

/**
 * Thin wrapper around SpaceSync, adds snapshot persistence and a few other things
 */
export class SyncEngine extends EventEmitter<SyncEngineEvents> {
  spaceSync!: SpaceSync;

  private syncConfig: SyncConfig = {
    syncDocuments: true,
  };

  stopping = false;
  syncAccepts: (path: string) => boolean = () => true;
  snapshot!: SyncSnapshot;

  constructor(
    private kv: KvPrimitives,
    readonly local: SpacePrimitives,
    readonly remote: HttpSpacePrimitives,
  ) {
    super();
  }

  async start() {
    this.snapshot = await this.loadSnapshot();

    this.spaceSync = new SpaceSync(this.local, this.remote, {
      conflictResolver: this.plugAwareConflictResolver.bind(this),
      isSyncCandidate: this.isSyncCandidate.bind(this),
    });

    this.spaceSync.on({
      syncProgress: (status) => {
        this.emit("syncProgress", status);
      },
      snapshotUpdated: this.saveSnapshot.bind(this),
    });

    // Start the sync loop
    this.run();
  }

  stop() {
    this.stopping = true;
  }

  async run() {
    while (true) {
      if (this.stopping) {
        return;
      }
      try {
        await this.syncSpace();
      } catch {
        // Error communication is happening in syncSpace
      }
      await sleep(syncInterval * 1000 + jitter());
    }
  }

  public setSyncConfig(config: SyncConfig) {
    this.syncConfig = config;
    this.syncAccepts = config.syncIgnore
      ? gitIgnoreCompiler(config.syncIgnore).accepts
      : () => true;
    console.log(
      "[sync] Updated sync config:",
      this.syncConfig,
    );
  }

  isSyncCandidate(path: string): boolean {
    // ALWAYS sync plugs
    if (path.startsWith(plugPrefix)) {
      return true;
    }
    // Follow SB_SYNC_IGNORE rules
    if (!this.syncAccepts(path)) {
      return false;
    }
    // Either sync all files, or only .md files if syncDocuments is false
    return this.syncConfig.syncDocuments || path.endsWith(".md");
  }

  async syncSpace(): Promise<number> {
    try {
      const operations = await this.spaceSync.syncFiles(this.snapshot);
      if (operations !== -1) {
        // emit successful sync event (not when operations === -1, because that means another sync was ongoing)
        this.emit("spaceSyncComplete", operations);
      }
      return operations;
    } catch (e) {
      this.emit("syncError", e);
      throw e;
    }
  }

  async syncSingleFile(path: string): Promise<number> {
    try {
      const operations = await this.spaceSync.syncSingleFile(
        path,
        this.snapshot,
      );
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
  async loadSnapshot(): Promise<SyncSnapshot> {
    const [snapshot] = await this.kv.batchGet([syncSnapshotKey]);
    return SyncSnapshot.fromJSON(snapshot);
  }

  /**
   * Saves the sync snapshot to the data store.
   * @param snapshot A map of sync status items.
   */
  saveSnapshot(snapshot: SyncSnapshot) {
    return this.kv.batchSet([{
      key: syncSnapshotKey,
      value: snapshot.toJSON(),
    }]);
  }

  async wipe() {
    this.stop();
    console.log("Wiping sync database");
    await this.kv.clear();
    console.log("Done wiping");
  }

  /**
   * Delegates to the standard primary conflict resolver, but in case of any conflicts in plugs, it will always take the version from the secondary.
   */
  async plugAwareConflictResolver(
    name: string,
    snapshot: SyncSnapshot,
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
      meta,
    );
    // Update snapshot
    snapshot.files.set(name, [
      newMeta.lastModified,
      meta.lastModified,
    ]);

    return 1;
  }
}
