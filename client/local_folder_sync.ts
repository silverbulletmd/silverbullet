import { jitter, sleep } from "@silverbulletmd/silverbullet/lib/async";
import type { KvPrimitives } from "./data/kv_primitives.ts";
import { EventEmitter } from "./plugos/event.ts";
import type { FsDirHandle } from "./spaces/fs_access_space_primitives.ts";
import type { SpacePrimitives } from "./spaces/space_primitives.ts";
import { SpaceSync, SyncSnapshot, type SyncStatus } from "./spaces/sync.ts";

const snapshotKey = ["$localFolder", "snapshot"];

const syncInterval = 20;

type LocalFolderSyncEvents = {
  spaceSyncComplete: (operations: number) => void | Promise<void>;
  syncConflict: (path: string) => void | Promise<void>;
  syncError: (error: Error, path?: string) => void | Promise<void>;
  syncProgress: (
    syncStatus: SyncStatus,
    snapshot: SyncSnapshot,
  ) => void | Promise<void>;
};

/**
 * Main-thread sync between the IndexedDB-backed local space and a real
 * filesystem folder (via the File System Access API). Used in local mode,
 * where there is no backend server and thus no service-worker sync engine.
 *
 * Structured after `service_worker/sync_engine.ts` (which wraps the same
 * `SpaceSync` for client↔server sync) but runs entirely on the main thread
 * and reuses `SpaceSync.primaryConflictResolver` so simultaneous edits on
 * both sides produce `.conflicted:` copies rather than silent data loss.
 */
export class LocalFolderSync extends EventEmitter<LocalFolderSyncEvents> {
  spaceSync!: SpaceSync;
  snapshot!: SyncSnapshot;
  private stopping = false;

  constructor(
    private kv: KvPrimitives,
    private local: SpacePrimitives,
    private folder: SpacePrimitives,
  ) {
    super();
  }

  async start() {
    await this.setup();
    void this.run();
  }

  async setup() {
    this.snapshot = await this.loadSnapshot();
    this.spaceSync = new SpaceSync(this.local, this.folder, {
      conflictResolver: this.conflictResolver.bind(this),
      isSyncCandidate: () => true,
    });
    this.spaceSync.on({
      syncProgress: async (status, snapshot) => {
        void this.emit("syncProgress", status, snapshot);
        await this.saveSnapshot(snapshot);
      },
      snapshotUpdated: this.saveSnapshot.bind(this),
    });
  }

  stop() {
    this.stopping = true;
  }

  private async run() {
    while (!this.stopping) {
      try {
        await this.syncSpace();
      } catch (e: any) {
        console.error("[local-folder-sync] sync error:", e.message);
      }
      await sleep(syncInterval * 1000 + jitter());
    }
  }

  async syncSpace(): Promise<number> {
    try {
      const operations = await this.spaceSync.syncFiles(this.snapshot);
      if (operations !== -1) {
        void this.emit("spaceSyncComplete", operations);
      }
      return operations;
    } catch (e) {
      void this.emit("syncError", e);
      throw e;
    }
  }

  async loadSnapshot(): Promise<SyncSnapshot> {
    const [snapshot] = await this.kv.batchGet([snapshotKey]);
    return SyncSnapshot.fromJSON(snapshot);
  }

  saveSnapshot(snapshot: SyncSnapshot) {
    return this.kv.batchSet([{ key: snapshotKey, value: snapshot.toJSON() }]);
  }

  async wipeSnapshot() {
    await this.kv.batchDelete([snapshotKey]);
  }

  private async conflictResolver(
    name: string,
    snapshot: SyncSnapshot,
    primary: SpacePrimitives,
    secondary: SpacePrimitives,
  ): Promise<number> {
    const operations = await SpaceSync.primaryConflictResolver(
      name,
      snapshot,
      primary,
      secondary,
    );
    if (operations > 0) {
      void this.emit("syncConflict", name);
    }
    return operations;
  }
}

declare global {
  function showDirectoryPicker(options?: {
    id?: string;
    mode?: "read" | "readwrite";
  }): Promise<FsDirHandle>;
}
