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

// Keeps the last time an activity was registered, used to detect if a sync is still alive and whether a new one should be started already
const syncLastActivityKey = "syncLastActivity";

// maximum time between two activities before we consider a sync crashed
const syncMaxIdleTimeout = 1000 * 20; // 20s

// How often to sync the whole space
const syncInterval = 10 * 1000; // Every 10s

/**
 * The SyncService primarily wraps the SpaceSync engine but also coordinates sync between
 * different browser tabs. It is using the KVStore to keep track of sync state.
 */
export class SyncService {
  spaceSync: SpaceSync;
  lastReportedSyncStatus = Date.now();

  constructor(
    private localSpacePrimitives: SpacePrimitives,
    private remoteSpace: SpacePrimitives,
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

    eventHook.addLocalListener("editor:pageLoaded", async (name) => {
      await this.syncFile(`${name}.md`);
    });

    eventHook.addLocalListener("page:saved", async (name) => {
      await this.syncFile(`${name}.md`);
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
      return false;
    }
    return true;
  }

  async hasInitialSyncCompleted(): Promise<boolean> {
    // Initial sync has happened when sync progress has been reported at least once, but the syncStartTime has been reset (which happens after sync finishes)
    return !!(!(await this.kvStore.get(syncStartTimeKey)) &&
      (await this.kvStore.get(syncLastActivityKey)));
  }

  async registerSyncStart(): Promise<void> {
    // Assumption: this is called after an isSyncing() check
    await this.kvStore.set(syncStartTimeKey, Date.now());
    await this.kvStore.set(syncLastActivityKey, Date.now());
  }

  async registerSyncProgress(status?: SyncStatus): Promise<void> {
    // Emit a sync event at most every 10s
    if (status && this.lastReportedSyncStatus < Date.now() - 10000) {
      this.eventHook.dispatchEvent("sync:progress", status);
      this.lastReportedSyncStatus = Date.now();
      await this.saveSnapshot(status.snapshot);
    }
    await this.kvStore.set(syncLastActivityKey, Date.now());
  }

  async registerSyncStop(): Promise<void> {
    await this.registerSyncProgress();
    await this.kvStore.del(syncStartTimeKey);
  }

  async getSnapshot(): Promise<Map<string, SyncStatusItem>> {
    const snapshot = (await this.kvStore.get(syncSnapshotKey)) || {};
    return new Map<string, SyncStatusItem>(
      Object.entries(snapshot),
    );
  }

  start() {
    this.syncSpace().catch(
      console.error,
    );

    setInterval(async () => {
      try {
        const lastActivity = (await this.kvStore.get(syncLastActivityKey)) || 0;
        if (lastActivity && Date.now() - lastActivity > syncInterval) {
          // It's been a while since the last activity, let's sync the whole space
          // The reason to do this check is that there may be multiple tabs open each with their sync cycle
          await this.syncSpace();
        }
      } catch (e: any) {
        console.error(e);
      }
    }, syncInterval / 2); // check every half the sync cycle because actually running the sync takes some time therefore we don't want to wait for the full cycle
  }

  async syncSpace(): Promise<number> {
    if (await this.isSyncing()) {
      console.log("Already syncing");
      return 0;
    }
    await this.registerSyncStart();
    let operations = 0;
    const snapshot = await this.getSnapshot();
    try {
      operations = await this.spaceSync!.syncFiles(snapshot);
      this.eventHook.dispatchEvent("sync:success", operations);
    } catch (e: any) {
      this.eventHook.dispatchEvent("sync:error", e.message);
      console.error("Sync error", e);
    }
    await this.saveSnapshot(snapshot);
    await this.registerSyncStop();
    return operations;
  }

  async syncFile(name: string) {
    if (await this.isSyncing()) {
      // console.log("Already syncing");
      return;
    }
    if (!this.isSyncCandidate(name)) {
      return;
    }
    await this.registerSyncStart();
    console.log("Syncing file", name);
    const snapshot = await this.getSnapshot();
    try {
      let localHash: number | undefined = undefined;
      let remoteHash: number | undefined = undefined;
      try {
        localHash =
          (await this.localSpacePrimitives.getFileMeta(name)).lastModified;
      } catch {
        // Not present
      }
      try {
        // This is wasteful, but Netlify (silverbullet.md) doesn't support OPTIONS call (404s) so we'll just fetch the whole file
        const { meta } = await this.remoteSpace!.readFile(name);
        remoteHash = meta.lastModified;
      } catch (e: any) {
        if (e.message === "Not found") {
          // File doesn't exist remotely, that's ok
        } else {
          throw e;
        }
      }

      await this.spaceSync!.syncFile(snapshot, name, localHash, remoteHash);
      this.eventHook.dispatchEvent("sync:success");
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
    const fileMeta = await primary.getFileMeta(name);

    // Read file from secondary
    const { data } = await secondary.readFile(
      name,
    );
    // Write file to primary
    const newMeta = await primary.writeFile(
      name,
      data,
      false,
      fileMeta.lastModified,
    );
    // Update snapshot
    snapshot.set(name, [
      newMeta.lastModified,
      fileMeta.lastModified,
    ]);
    return 1;
  }
}
