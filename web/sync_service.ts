import { sleep } from "../common/async_util.ts";
import type { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import {
  SpaceSync,
  SyncStatus,
  SyncStatusItem,
} from "../common/spaces/sync.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { KVStore } from "../plugos/lib/kv_store.ts";

// Keeps the current sync snapshot
const syncSnapshotKey = "syncSnapshot";

// Keeps the start time of an ongoing sync, is reset once the sync is done
const syncStartTimeKey = "syncStartTime";

// Keeps the start time of the last full sync cycle
const syncLastFullCycleKey = "syncLastFullCycle";

// Keeps the last time an activity was registered, used to detect if a sync is still alive and whether a new one should be started already
const syncLastActivityKey = "syncLastActivity";

const syncInitialFullSyncCompletedKey = "syncInitialFullSyncCompleted";

// maximum time between two activities before we consider a sync crashed
const syncMaxIdleTimeout = 1000 * 27;

// How often to sync the whole space
const spaceSyncInterval = 17 * 1000; // Every 17s or so

// Used from Client
export const pageSyncInterval = 6000;

/**
 * The SyncService primarily wraps the SpaceSync engine but also coordinates sync between
 * different browser tabs. It is using the KVStore to keep track of sync state.
 */
export class SyncService {
  spaceSync: SpaceSync;
  lastReportedSyncStatus = Date.now();

  constructor(
    readonly localSpacePrimitives: SpacePrimitives,
    readonly remoteSpace: SpacePrimitives,
    private kvStore: KVStore,
    private eventHook: EventHook,
    private isSyncCandidate: (path: string) => boolean,
  ) {
    this.spaceSync = new SpaceSync(
      this.localSpacePrimitives,
      this.remoteSpace!,
      {
        conflictResolver: this.plugAwareConflictResolver.bind(this),
        isSyncCandidate: this.isSyncCandidate,
        onSyncProgress: (status) => {
          this.registerSyncProgress(status).catch(console.error);
        },
      },
    );

    eventHook.addLocalListener(
      "editor:pageLoaded",
      (name, _prevPage, isSynced) => {
        if (!isSynced) {
          this.scheduleFileSync(`${name}.md`).catch(console.error);
        }
      },
    );

    eventHook.addLocalListener("editor:pageSaved", (name) => {
      const path = `${name}.md`;
      this.scheduleFileSync(path).catch(console.error);
    });
  }

  async isSyncing(): Promise<boolean> {
    const startTime = await this.kvStore.get(syncStartTimeKey);
    if (!startTime) {
      return false;
    }
    // Sync is running, but is it still alive?
    const lastActivity = await this.kvStore.get(syncLastActivityKey)!;
    if (Date.now() - lastActivity > syncMaxIdleTimeout) {
      // It's been too long since the last activity, let's consider this one crashed and
      // reset the sync start state
      await this.kvStore.del(syncStartTimeKey);
      console.info("Sync crashed, resetting");
      return false;
    }
    return true;
  }

  hasInitialSyncCompleted(): Promise<boolean> {
    // Initial sync has happened when sync progress has been reported at least once, but the syncStartTime has been reset (which happens after sync finishes)
    return this.kvStore.has(syncInitialFullSyncCompletedKey);
  }

  async registerSyncStart(fullSync: boolean): Promise<void> {
    // Assumption: this is called after an isSyncing() check
    await this.kvStore.batchSet([
      {
        key: syncStartTimeKey,
        value: Date.now(),
      },
      {
        key: syncLastActivityKey,
        value: Date.now(),
      },
      ...fullSync // If this is a full sync cycle
        ? [{
          key: syncLastFullCycleKey,
          value: Date.now(),
        }]
        : [],
    ]);
  }

  async registerSyncProgress(status?: SyncStatus): Promise<void> {
    // Emit a sync event at most every 2s
    if (status && this.lastReportedSyncStatus < Date.now() - 2000) {
      this.eventHook.dispatchEvent("sync:progress", status);
      this.lastReportedSyncStatus = Date.now();
      await this.saveSnapshot(status.snapshot);
    }
    await this.kvStore.set(syncLastActivityKey, Date.now());
  }

  async registerSyncStop(): Promise<void> {
    await this.registerSyncProgress();
    await this.kvStore.del(syncStartTimeKey);
    await this.kvStore.set(syncInitialFullSyncCompletedKey, true);
  }

  async getSnapshot(): Promise<Map<string, SyncStatusItem>> {
    const snapshot = (await this.kvStore.get(syncSnapshotKey)) || {};
    return new Map<string, SyncStatusItem>(
      Object.entries(snapshot),
    );
  }

  // Await a moment when the sync is no longer running
  async noOngoingSync(timeout: number): Promise<void> {
    // Not completely safe, could have race condition on setting the syncStartTimeKey
    const startTime = Date.now();
    while (await this.isSyncing()) {
      await sleep(321);
      if (Date.now() - startTime > timeout) {
        throw new Error("Timeout waiting for sync to finish");
      }
    }
  }

  filesScheduledForSync = new Set<string>();
  async scheduleFileSync(path: string): Promise<void> {
    if (this.filesScheduledForSync.has(path)) {
      // Already scheduled, no need to duplicate
      console.info(`File ${path} already scheduled for sync`);
      return;
    }
    this.filesScheduledForSync.add(path);
    await this.noOngoingSync(7000);
    await this.syncFile(path);
    this.filesScheduledForSync.delete(path);
  }

  start() {
    this.syncSpace().catch(console.error);

    setInterval(async () => {
      try {
        if (!await this.isSyncing()) {
          const lastFullCycle =
            (await this.kvStore.get(syncLastFullCycleKey)) || 0;
          if (lastFullCycle && Date.now() - lastFullCycle > spaceSyncInterval) {
            // It's been a while since the last full cycle, let's sync the whole space
            await this.syncSpace();
          }
        }
      } catch (e: any) {
        console.error(e);
      }
    }, spaceSyncInterval / 2); // check every half the sync cycle because actually running the sync takes some time therefore we don't want to wait for the full cycle
  }

  async syncSpace(): Promise<number> {
    if (await this.isSyncing()) {
      console.log("Aborting space sync: already syncing");
      return 0;
    }
    await this.registerSyncStart(true);
    let operations = 0;
    const snapshot = await this.getSnapshot();
    // console.log("Excluded from sync", excludedFromSync);
    try {
      operations = await this.spaceSync!.syncFiles(
        snapshot,
        (path) => this.isSyncCandidate(path),
      );
      await this.saveSnapshot(snapshot);
      await this.registerSyncStop();
      this.eventHook.dispatchEvent("sync:success", operations);
    } catch (e: any) {
      await this.saveSnapshot(snapshot);
      await this.registerSyncStop();
      this.eventHook.dispatchEvent("sync:error", e.message);
      console.error("Sync error", e.message);
    }
    return operations;
  }

  // Syncs a single file
  async syncFile(name: string) {
    if (!this.isSyncCandidate(name)) {
      return;
    }
    if (await this.isSyncing()) {
      console.log("Already syncing, aborting individual file sync for", name);
      return;
    }
    await this.registerSyncStart(false);
    console.log("Syncing file", name);
    const snapshot = await this.getSnapshot();
    try {
      let localHash: number | undefined;
      let remoteHash: number | undefined;
      try {
        const localMeta = await this.localSpacePrimitives.getFileMeta(name);
        if (localMeta.noSync) {
          console.info(
            "File marked as no sync, skipping sync in this cycle",
            name,
          );
          await this.registerSyncStop();
          return;
        }
        localHash = localMeta.lastModified;
      } catch {
        // Not present
      }
      try {
        remoteHash = (await this.remoteSpace!.getFileMeta(name)).lastModified;
      } catch (e: any) {
        if (e.message === "Not found") {
          // File doesn't exist remotely, that's ok
        } else {
          throw e;
        }
      }

      await this.spaceSync.syncFile(snapshot, name, localHash, remoteHash);
      this.eventHook.dispatchEvent("sync:success");
      console.log("File successfully synced", name);
    } catch (e: any) {
      this.eventHook.dispatchEvent("sync:error", e.message);
      console.error("Sync error", e);
    }
    await this.saveSnapshot(snapshot);
    await this.registerSyncStop();
  }

  async saveSnapshot(snapshot: Map<string, SyncStatusItem>) {
    await this.kvStore.set(syncSnapshotKey, Object.fromEntries(snapshot));
  }

  public async plugAwareConflictResolver(
    name: string,
    snapshot: Map<string, SyncStatusItem>,
    primary: SpacePrimitives,
    secondary: SpacePrimitives,
  ): Promise<number> {
    if (!name.startsWith("_plug/")) {
      const operations = await SpaceSync.primaryConflictResolver(
        name,
        snapshot,
        primary,
        secondary,
      );

      if (operations > 0) {
        // Something happened -> conflict copy generated, let's report it
        await this.eventHook.dispatchEvent("sync:conflict", name);
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
