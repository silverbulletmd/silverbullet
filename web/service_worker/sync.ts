import type { DataStore } from "../../lib/data/datastore.ts";
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
const syncInterval = 10 * 1000;

type SyncEngineEvents = {
  spaceSyncComplete: (operations: number) => void;
  syncError: (error: Error) => void;
  syncConflict: (path: string) => void;
  fileSyncComplete: (path: string) => void;
  syncProgress: (syncStatus: SyncStatus) => void | Promise<void>;
};

export class SyncEngine extends EventEmitter<SyncEngineEvents> {
  spaceSync!: SpaceSync;
  nonSyncedFiles = new Map<string, FileMeta>();

  constructor(
    private ds: DataStore,
    readonly local: SpacePrimitives,
    readonly remote: SpacePrimitives,
  ) {
    super();
  }

  async start() {
    const initialSnapshot = await this.getSnapshot();

    this.spaceSync = new SpaceSync(this.local, this.remote, initialSnapshot, {
      conflictResolver: this.plugAwareConflictResolver.bind(this),
      isSyncCandidate: this.isSyncCandidate.bind(this),
    });

    this.spaceSync.on({
      syncProgress: (status) => {
        // Propagate
        this.emit("syncProgress", status);
      },
      snapshotUpdated: this.saveSnapshot.bind(this),
    });
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

  async syncSpace(): Promise<number> {
    const { operations, nonSyncedFiles } = await this.spaceSync.syncFiles();
    this.nonSyncedFiles = nonSyncedFiles;
    this.emit("spaceSyncComplete", operations);
    return operations;
  }

  syncSingleFile(path: string) {
    return this.spaceSync.syncSingleFile(path);
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
