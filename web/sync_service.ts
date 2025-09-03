import { plugPrefix, stdLibPrefix } from "../lib/spaces/constants.ts";
import type { SpacePrimitives } from "../lib/spaces/space_primitives.ts";
import {
  SpaceSync,
  type SyncStatus,
  type SyncStatusItem,
} from "../lib/spaces/sync.ts";
import { sleep } from "../lib/async.ts";
import type { EventHook } from "./hooks/event.ts";
import type { DataStore } from "../lib/data/datastore.ts";

// Keeps the current sync snapshot
const syncSnapshotKey = ["sync", "snapshot"];

// Keeps the start time of an ongoing sync, is reset once the sync is done
const syncStartTimeKey = ["sync", "startTime"];

// Keeps the start time of the last full sync cycle
const syncLastFullCycleKey = ["sync", "lastFullCycle"];

// Keeps the last time an activity was registered, used to detect if a sync is still alive and whether a new one should be started already
const syncLastActivityKey = ["sync", "lastActivity"];

const syncInitialFullSyncCompletedKey = ["sync", "initialFullSyncCompleted"];

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
  lastReportedSyncStatus = Date.now();
  // If this is set to anything other than undefined, a file is currently saving
  savingTimeout: number | undefined;
  enabled = true;
  filesScheduledForSync = new Set<string>();

  constructor(
    readonly localSpacePrimitives: SpacePrimitives,
    readonly remoteSpace: SpacePrimitives,
    private ds: DataStore,
    private eventHook: EventHook,
    private isSyncCandidate: (path: string) => boolean,
  ) {
    // this.spaceSync = new SpaceSync(
    //   this.localSpacePrimitives,
    //   this.remoteSpace!,
    //   {
    //     conflictResolver: this.plugAwareConflictResolver.bind(this),
    //     isSyncCandidate: this.isSyncCandidate,
    //     onSyncProgress: (status) => {
    //       this.registerSyncProgress(status).catch(console.error);
    //     },
    //   },
    // );

    eventHook.addLocalListener(
      "editor:pageLoaded",
      (name, _prevPage, isSynced) => {
        if (!this.enabled) {
          return;
        }
        if (!isSynced) {
          this.performFileSync(`${name}.md`).catch(console.error);
        }
      },
    );

    eventHook.addLocalListener("editor:documentLoaded", (name, _prevPage) => {
      if (!this.enabled) {
        return;
      }
      this.performFileSync(name).catch(console.error);
    });

    const setSavingTimeout = () => {
      this.savingTimeout = setTimeout(() => {
        this.savingTimeout = undefined;
      }, 1000 * 5);
    };

    eventHook.addLocalListener("editor:pageSaving", setSavingTimeout);

    eventHook.addLocalListener("editor:documentSaving", setSavingTimeout);

    eventHook.addLocalListener("editor:pageSaved", (name) => {
      if (!this.enabled) {
        return;
      }
      if (this.savingTimeout) {
        clearTimeout(this.savingTimeout);
        this.savingTimeout = undefined;
      } else {
        console.warn("This should not happen, savingTimeout was not set");
      }
      const path = `${name}.md`;
      this.performFileSync(path).catch(console.error);
    });

    eventHook.addLocalListener("editor:documentSaved", (name) => {
      if (!this.enabled) {
        return;
      }
      if (this.savingTimeout) {
        clearTimeout(this.savingTimeout);
        this.savingTimeout = undefined;
      } else {
        console.warn(
          "This should not happen, savingTimeout was not set. This could be a slow document editor",
        );
      }
      this.performFileSync(name).catch(console.error);
    });

    // this.spaceSync.on({
    //   fileSynced: (meta, direction) => {
    //     eventHook.dispatchEvent("file:synced", meta, direction);
    //   },
    // });
  }

  async isSyncing(): Promise<boolean> {
    if (this.savingTimeout !== undefined) {
      console.log(
        "Saving a file at the moment, so reporting as isSyncing() = true",
      );
      return true;
    }
    const startTime = await this.ds.get(syncStartTimeKey);
    if (!startTime) {
      return false;
    }
    // Sync is running, but is it still alive?
    const lastActivity = await this.ds.get(syncLastActivityKey)!;
    if (Date.now() - lastActivity > syncMaxIdleTimeout) {
      // It's been too long since the last activity, let's consider this one crashed and
      // reset the sync start state
      await this.ds.delete(syncStartTimeKey);
      console.info("Sync without activity for too long, resetting");
      return false;
    }
    return true;
  }

  async hasInitialSyncCompleted(): Promise<boolean> {
    // Initial sync has happened when sync progress has been reported at least once, but the syncStartTime has been reset (which happens after sync finishes)
    return !!(await this.ds.get(syncInitialFullSyncCompletedKey));
  }

  async registerSyncStart(fullSync: boolean): Promise<void> {
    // Assumption: this is called after an isSyncing() check
    await this.ds.batchSet([
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
      await this.eventHook.dispatchEvent("sync:progress", status);
      this.lastReportedSyncStatus = Date.now();
      await this.saveSnapshot(status.snapshot);
    }
    await this.ds.set(syncLastActivityKey, Date.now());
  }

  async registerSyncStop(isFullSync: boolean): Promise<void> {
    await this.registerSyncProgress();
    await this.ds.delete(syncStartTimeKey);
    if (isFullSync) {
      await this.ds.set(syncInitialFullSyncCompletedKey, true);
    }
  }

  async getSnapshot(): Promise<Map<string, SyncStatusItem>> {
    const snapshot = (await this.ds.get(syncSnapshotKey)) || {};
    return new Map<string, SyncStatusItem>(
      Object.entries(snapshot),
    );
  }

  // Await a moment when the sync is no longer running
  async noOngoingSync(timeout: number): Promise<void> {
    // Not completely safe, could have race condition on setting the syncStartTimeKey
    const startTime = Date.now();
    while (await this.isSyncing()) {
      console.log("Waiting for ongoing sync to finish...");
      await sleep(321);
      if (Date.now() - startTime > timeout) {
        throw new Error("Timeout waiting for sync to finish");
      }
    }
  }

  /**
   * Performs a file sync for a single file, returns once sync has completed.
   * @param path path of file to sync
   */
  async performFileSync(path: string): Promise<void> {
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

  async performSpaceSync(): Promise<number> {
    await this.noOngoingSync(5000);
    return this.syncSpace();
  }

  start() {
    this.syncSpace().catch(console.error);

    setInterval(async () => {
      if (!this.enabled) {
        return;
      }
      try {
        if (!await this.isSyncing()) {
          const lastFullCycle = (await this.ds.get(syncLastFullCycleKey)) || 0;
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

  /**
   * Performs a full space sync
   * @return the number of sync operations performed, or -1 when a sync was already in progress
   */
  async syncSpace(): Promise<number> {
    // if (!this.enabled) {
    //   return 0;
    // }
    // if (await this.isSyncing()) {
    //   console.log("Aborting space sync: already syncing");
    //   return -1;
    // }
    // await this.registerSyncStart(true);
    // let operations = 0;
    // const snapshot = await this.getSnapshot();
    // // console.log("Excluded from sync", excludedFromSync);
    // try {
    //   operations = await this.spaceSync!.syncFiles(
    //     snapshot,
    //     (path) => this.isSyncCandidate(path),
    //   );
    //   await this.saveSnapshot(snapshot);
    //   await this.registerSyncStop(true);
    //   await this.eventHook.dispatchEvent("sync:success", operations);
    // } catch (e: any) {
    //   await this.saveSnapshot(snapshot);
    //   await this.registerSyncStop(false);
    //   await this.eventHook.dispatchEvent("sync:error", e.message);
    //   console.error("Sync error", e.message);
    // }
    // return operations;
    return -1;
  }

  // Syncs a single file
  async syncFile(name: string) {
    if (!this.enabled) {
      return;
    }
    // console.log("Checking if we can sync file", name);
    if (!this.isSyncCandidate(name)) {
      console.info("Requested sync, but not a sync candidate", name);
      return;
    }
    if (await this.isSyncing()) {
      console.log("Already syncing, aborting individual file sync for", name);
      return;
    }
    console.log("Syncing file", name);
    await this.registerSyncStart(false);
    const snapshot = await this.getSnapshot();
    try {
      let localHash: number | undefined;
      let remoteHash: number | undefined;

      // Fetch remote first (potentially more laggy)
      try {
        remoteHash = (await this.remoteSpace!.getFileMeta(name)).lastModified;
        // HEAD
        //
        if (!remoteHash) {
          console.info(
            "Not syncing file, because remote didn't send X-Last-Modified header",
          );
          // This happens when the remote isn't a real SilverBullet server, specifically: it's not sending
          // a X-Last-Modified header. In this case we'll just assume that the file is up to date.
          await this.registerSyncStop(false);
          // Jumping out, not saving snapshot nor triggering a sync event, because we did nothing
          return;
        }
      } catch (e: any) {
        if (e.message === "Not found") {
          // File doesn't exist remotely, that's ok
        } else {
          throw e;
        }
      }

      // Fetch local file meta
      try {
        const localMeta = await this.localSpacePrimitives.getFileMeta(name);
        if (localMeta.noSync) {
          console.info(
            "File marked as no sync, skipping sync in this cycle",
            name,
          );
          await this.registerSyncStop(false);
          // Jumping out, not saving snapshot nor triggering a sync event, because we did nothing
          return;
        }
        localHash = localMeta.lastModified;
      } catch {
        // Not present
      }

      // await this.spaceSync.syncFile(snapshot, name, localHash, remoteHash);
      this.eventHook.dispatchEvent("sync:success").catch(console.error);
      // console.log("File successfully synced", name);
    } catch (e: any) {
      this.eventHook.dispatchEvent("sync:error", e.message).catch(
        console.error,
      );
      console.error("Sync error", e);
    }
    await this.saveSnapshot(snapshot);
    await this.registerSyncStop(false);
  }

  async saveSnapshot(snapshot: Map<string, SyncStatusItem>) {
    await this.ds.set(syncSnapshotKey, Object.fromEntries(snapshot));
  }

  close() {
    this.enabled = false;
  }

  public async plugAwareConflictResolver(
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
