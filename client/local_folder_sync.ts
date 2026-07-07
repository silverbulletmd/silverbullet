import { jitter, sleep } from "@silverbulletmd/silverbullet/lib/async";
import type { KvPrimitives } from "./data/kv_primitives.ts";
import { EventEmitter } from "./plugos/event.ts";
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
  // Serializes syncSpace() calls (the run loop and visibility-triggered syncs
  // both call it) so stop() can reliably wait for the in-flight one. Without
  // this, a reconnect could start a new SpaceSync (with its own isSyncing
  // mutex) while the old engine was still mid-write to the same folder handle,
  // silently losing the loser's write — two createWritable() streams on the
  // same FSA file handle are independent and last-close-wins.
  private syncChain: Promise<number> = Promise.resolve(0);
  // Serializes snapshot persistence so a disconnect can't wipe the snapshot
  // while a saveSnapshot() triggered by the last sync cycle (syncFiles emits
  // `snapshotUpdated` fire-and-forget in its finally block) is still in flight,
  // which would otherwise re-create the snapshot after wipe.
  private pendingSnapshotSave: Promise<void> = Promise.resolve();

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

  /**
   * Signal the run loop to stop and resolve once any in-flight sync iteration
   * (and the snapshot save it may have kicked off) has settled. Await this
   * before constructing a new LocalFolderSync for the same handle or wiping
   * state, otherwise the old and new engines can race on the same files.
   */
  stop(): Promise<void> {
    this.stopping = true;
    return Promise.all([this.syncChain, this.pendingSnapshotSave]).then(
      () => undefined,
    );
  }

  private async run() {
    while (!this.stopping) {
      try {
        await this.syncSpace();
      } catch (e: any) {
        console.error("[local-folder-sync] sync error:", e.message);
      }
      if (this.stopping) break;
      await sleep(syncInterval * 1000 + jitter());
    }
  }

  async syncSpace(): Promise<number> {
    // Refuse new work after stop() has signaled shutdown. This closes the
    // narrow gap between stop() resolving and the caller nulling its reference.
    if (this.stopping) return -1;
    // Queue on syncChain so concurrent callers (run loop + visibility handler)
    // don't overlap, and so stop() can await the in-flight sync.
    const run = this.syncChain.then(() => this.performSync());
    this.syncChain = run.then(
      () => 0,
      () => 0,
    );
    return run;
  }

  private async performSync(): Promise<number> {
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
    // Chain so the snapshot is persisted in emit order and so stop() can await
    // a single tail promise that resolves only when every queued save is done.
    const p = this.pendingSnapshotSave
      .catch(() => undefined)
      .then(() =>
        this.kv.batchSet([{ key: snapshotKey, value: snapshot.toJSON() }]),
      );
    this.pendingSnapshotSave = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
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

// showDirectoryPicker() is not in this TypeScript version's lib.dom.d.ts, so
// declare it here returning the standard DOM type. When the lib ships it, the
// signatures match exactly (no fragile overload merge). Callers that need the
// narrow FsDirHandle view cast at the call site.
declare global {
  function showDirectoryPicker(options?: {
    id?: string;
    mode?: "read" | "readwrite";
  }): Promise<FileSystemDirectoryHandle>;
}
