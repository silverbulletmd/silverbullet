import { jitter } from "@silverbulletmd/silverbullet/lib/async";
import { compile as gitIgnoreCompiler } from "gitignore-parser";
import type { KvPrimitives } from "../data/kv_primitives.ts";
import { EventEmitter } from "../plugos/event.ts";
import { BaseStore } from "../spaces/base_store.ts";
import { stdLibPrefix } from "../spaces/constants.ts";
import type { HttpSpacePrimitives } from "../spaces/http_space_primitives.ts";
import type { SpacePrimitives } from "../spaces/space_primitives.ts";
import {
  isMergeEligible,
  SpaceSync,
  type SyncSignal,
  SyncSnapshot,
  type SyncStatus,
} from "../spaces/sync.ts";
import {
  DirtyQueue,
  localWriteIsEcho,
  signalFor,
  type SyncOrigin,
  shouldSkip,
} from "./dirty_queue.ts";

const syncSnapshotKey = ["$sync", "snapshot"];
const syncInterval = 20;
const syncIntervalRealtimeHealthy = 60;
const realtimeHealthTtlMs = 45_000;

type SyncEngineEvents = {
  // Full sync cycle has completed
  spaceSyncComplete: (operations: number) => void | Promise<void>;

  // A single file syncle has completed
  fileSyncComplete: (path: string, operations: number) => void | Promise<void>;

  syncError: (error: Error, path?: string) => void | Promise<void>;

  // Sync conflict occurred
  syncConflict: (path: string) => void | Promise<void>;

  // A local deletion was suppressed because the file was edited elsewhere
  suppressedDeletion: (path: string) => void | Promise<void>;

  // Sync progress updated
  syncProgress: (
    syncStatus: SyncStatus,
    snapshot: SyncSnapshot,
  ) => void | Promise<void>;
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

  private queue = new DirtyQueue();
  private realtimeHealthyUntil = 0;
  private baseStore!: BaseStore;

  constructor(
    private kv: KvPrimitives,
    readonly local: SpacePrimitives,
    readonly remote: HttpSpacePrimitives,
  ) {
    super();
  }

  listSafety(): Promise<{ hash: string; size: number; ts: number }[]> {
    return this.baseStore.listSafety();
  }

  getSafety(hash: string): Promise<Uint8Array | null> {
    return this.baseStore.getSafety(hash);
  }

  requestFileSync(path: string, origin: SyncOrigin) {
    this.queue.mark(path, origin);
  }

  requestSpaceSync() {
    this.queue.markFullScan();
  }

  /**
   * Records the revision an open editor's unsaved buffer descends from, ahead
   * of a write that is a sibling of what the local replica holds rather than a
   * descendant of it (the editor withheld an external update it could not
   * merge).
   *
   * Both the merge base and the expected remote revision move back to that
   * older revision, which is what routes the next push through three-way
   * reconciliation: stating it as the precondition makes the push fail, and
   * `tryReconcile` then submits base plus proposal to the server, which merges
   * against the revision the editor never saw instead of letting it be
   * overwritten. Nothing has to clear this again — the reconciliation writes
   * both entries itself.
   */
  async declareDivergentBase(path: string, baseText: string): Promise<void> {
    if (!this.baseStore || !this.snapshot) {
      console.warn("[sync] Not yet started, ignoring divergent base for", path);
      return;
    }
    const data = new TextEncoder().encode(baseText);
    // Same eligibility gate captureBase applies: an ineligible path has no
    // three-way merge to route into, so arming one would only trade a push
    // for a rejected reconcile attempt and a conflict copy.
    if (!isMergeEligible(path, data.byteLength)) {
      return;
    }
    const hash = await this.baseStore.putBase(data);
    console.log("[sync]", "Editor buffer diverged from", hash, path);
    this.snapshot.baseHashes.set(path, hash);
    // Only where this replica has seen the remote report revisions at all;
    // against a pre-revision remote the precondition would be ignored and the
    // recorded hash would just misrepresent what the remote holds.
    if (this.snapshot.remoteHashes.size > 0) {
      this.snapshot.remoteHashes.set(path, hash);
    }
    await this.saveSnapshot(this.snapshot);
  }

  notifyRealtimeStatus(connected: boolean) {
    this.realtimeHealthyUntil = connected
      ? Date.now() + realtimeHealthTtlMs
      : 0;
  }

  isRealtimeHealthy(): boolean {
    return Date.now() < this.realtimeHealthyUntil;
  }

  async start() {
    this.snapshot = await this.loadSnapshot();
    this.baseStore = new BaseStore(this.kv);

    this.spaceSync = new SpaceSync(this.local, this.remote, {
      conflictResolver: this.stdLibAwareConflictResolver.bind(this),
      isSyncCandidate: this.isSyncCandidate.bind(this),
      baseStore: this.baseStore,
      onScheduleResync: (path) => this.queue.mark(path, { type: "any" }),
    });

    this.spaceSync.on({
      syncProgress: async (status, snapshot) => {
        void this.emit("syncProgress", status, snapshot);
        await this.saveSnapshot(snapshot);
      },
      snapshotUpdated: this.saveSnapshot.bind(this),
      syncConflict: (path) => {
        void this.emit("syncConflict", path);
      },
      suppressedDeletion: (path) => {
        void this.emit("suppressedDeletion", path);
      },
    });

    // Start the sync loop
    void this.run();
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
      } catch (e: any) {
        // User error communication is happening in syncSpace
        console.error("Sync space error", e.message);
      }

      const interval = this.isRealtimeHealthy()
        ? syncIntervalRealtimeHealthy
        : syncInterval;
      const deadline = Date.now() + interval * 1000 + jitter();
      drain: while (Date.now() < deadline) {
        if (this.stopping) {
          return;
        }
        const taken = await this.queue.take(
          Math.min(deadline - Date.now(), 500),
        );
        switch (taken.kind) {
          case "timeout":
            continue;
          case "fullScan":
            break drain;
          case "path": {
            const { path, origin } = taken;
            const snapEntry = this.snapshot.files.get(path);
            const recordedHash = this.snapshot.remoteHashes.get(path);
            if (
              shouldSkip(
                origin,
                snapEntry,
                recordedHash,
                this.isRealtimeHealthy(),
              )
            ) {
              // Deduped/echo work still resolves performFileSync waiters
              void this.emit("fileSyncComplete", path, 0);
              continue;
            }
            if (origin.type === "local") {
              const localMtime = await this.local.getFileMeta(path).then(
                (m) => m.lastModified,
                () => undefined,
              );
              if (
                await localWriteIsEcho(
                  this.local,
                  path,
                  localMtime,
                  snapEntry,
                  recordedHash,
                )
              ) {
                void this.emit("fileSyncComplete", path, 0);
                continue;
              }
            }
            try {
              const operations = await this.syncSingleFile(
                path,
                signalFor(origin),
              );
              if (operations === -1) {
                this.queue.mark(path, origin);
              }
            } catch (e: any) {
              console.error("Single file sync error", path, e.message);
            }
          }
        }
      }
    }
  }

  public setSyncConfig(config: SyncConfig) {
    this.syncConfig = config;
    this.syncAccepts = config.syncIgnore
      ? gitIgnoreCompiler(config.syncIgnore).accepts
      : () => true;
    console.log("[sync] Updated sync config:", this.syncConfig);
  }

  isSyncCandidate(path: string): boolean {
    // ALWAYS sync plugs
    if (path.endsWith(".plug.js")) {
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
        await this.baseStore.pruneSafety();
        await this.baseStore.pruneBases(
          new Set(this.snapshot.baseHashes.values()),
        );
        // emit successful sync event (not when operations === -1, because that means another sync was ongoing)
        void this.emit("spaceSyncComplete", operations);
      }
      return operations;
    } catch (e) {
      void this.emit("syncError", e);
      throw e;
    }
  }

  async syncSingleFile(
    path: string,
    signal: SyncSignal = { type: "unknown" },
  ): Promise<number> {
    try {
      const operations = await this.spaceSync.syncSingleFile(
        path,
        this.snapshot,
        signal,
      );
      void this.emit("fileSyncComplete", path, operations);
      return operations;
    } catch (e) {
      void this.emit("syncError", e, path);
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
    return this.kv.batchSet([
      {
        key: syncSnapshotKey,
        value: snapshot.toJSON(),
      },
    ]);
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
  async stdLibAwareConflictResolver(
    name: string,
    snapshot: SyncSnapshot,
    primary: SpacePrimitives,
    secondary: SpacePrimitives,
  ): Promise<number> {
    if (!name.startsWith(stdLibPrefix)) {
      const operations = await SpaceSync.primaryConflictResolver(
        name,
        snapshot,
        primary,
        secondary,
      );

      if (operations > 0) {
        // Something happened -> conflict copy generated, let's report it
        void this.emit("syncConflict", name);
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
    const { data, meta } = await secondary.readFile(name);
    // Write file to primary
    const newMeta = await primary.writeFile(name, data, meta);
    // Update snapshot
    snapshot.files.set(name, [newMeta.lastModified, meta.lastModified]);

    return 1;
  }
}
