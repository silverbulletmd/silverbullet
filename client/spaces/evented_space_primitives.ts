import type { EventHook } from "../plugos/hooks/event.ts";

import type { SpacePrimitives } from "./space_primitives.ts";
import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";
import type { DataStore } from "../data/datastore.ts";

/**
 * Events exposed:
 * - file:changed (string, oldHash, newHash)
 * - file:deleted (string)
 * - file:listed (FileMeta[])
 * - file:initial: triggered in case of an initially empty snapshot, after the first set of events has gone out
 * - page:saved (string, FileMeta)
 * - page:deleted (string)
 */
export class EventedSpacePrimitives implements SpacePrimitives {
  // Various operations may be going on at the same time, and we don't want to trigger events unnecessarily.
  // Therefore, we use this counter to track how many operations are in flight, and if so, we skip event triggering.
  private operationCount = 0;

  // When a fetchFileList is requested while operations are in flight, we defer it
  // so that synced changes are not missed.
  private deferredFetchFileList = false;

  private enabled = false;

  // Snapshot state management
  private spaceSnapshot: Record<string, number> = {};
  private snapshotChanged = false;

  constructor(
    private wrapped: SpacePrimitives,
    private eventHook: EventHook,
    private ds: DataStore,
    private snapshotKey = ["$spaceSnapshot"],
  ) {}

  async enable() {
    console.log("Loading snapshot and enabling events");
    this.spaceSnapshot = (await this.ds.get(this.snapshotKey)) || {};

    if (Object.keys(this.spaceSnapshot).length === 0) {
      // Fresh client or post-wipe: seed the snapshot from a file listing so
      // the first enabled fetchFileList does not treat every file as "new"
      // and re-queue indexing for the entire space.
      const files = await this.wrapped.fetchFileList();
      for (const meta of files) {
        this.spaceSnapshot[meta.name] = meta.lastModified;
      }
      this.snapshotChanged = true;
      await this.saveSnapshot();
    }

    this.snapshotChanged = false;
    this.enabled = true;
  }

  public isSnapshotEmpty() {
    return Object.keys(this.spaceSnapshot).length === 0;
  }

  public getSnapshot() {
    return this.spaceSnapshot;
  }

  private updateInSnapshot(key: string, value: number) {
    const oldValue = this.spaceSnapshot[key];
    this.spaceSnapshot[key] = value;
    this.snapshotChanged = this.snapshotChanged || oldValue !== value;
  }

  private deleteFromSnapshot(key: string) {
    delete this.spaceSnapshot[key];
    this.snapshotChanged = true;
  }

  private async saveSnapshot() {
    if (this.enabled && this.snapshotChanged) {
      await this.ds.set(this.snapshotKey, this.spaceSnapshot);
      this.snapshotChanged = false;
    }
  }

  /**
   * Called when an operation completes. If a fetchFileList was deferred
   * because operations were in flight, trigger it now.
   */
  private checkDeferredFetchFileList() {
    if (this.deferredFetchFileList && this.operationCount === 0) {
      this.deferredFetchFileList = false;
      // Schedule on next tick to avoid reentrancy
      setTimeout(() => {
        void this.fetchFileList();
      });
    }
  }

  dispatchEvent(name: string, ...args: any[]): Promise<any[]> {
    if (!this.enabled) {
      return Promise.resolve([]);
    }
    // console.log("Evented space, dispatching", name, args);
    return this.eventHook.dispatchEvent(name, ...args);
  }

  async fetchFileList(): Promise<FileMeta[]> {
    if (this.operationCount > 0) {
      // Some other operation (read, write, list, meta) is already going on
      // this will likely trigger events, so let's not worry about any of that and avoid race condition and inconsistent data.
      // We mark a deferred flag so the next operation completion will trigger a fetchFileList.
      console.info(
        "deferredFetchFileList: skipping event triggering for fetchFileList.",
      );
      this.deferredFetchFileList = true;
      return this.wrapped.fetchFileList();
    }
    if (!this.enabled) {
      return this.wrapped.fetchFileList();
    }
    // console.log("Fetching file list");
    // Fetching mutex
    this.operationCount++;
    try {
      // Fetch the list
      const newFileList = await this.wrapped.fetchFileList();

      // Now we have the list, let's compare it to the snapshot and trigger events appropriately
      const deletedFiles = new Set<string>(Object.keys(this.spaceSnapshot));
      for (const meta of newFileList) {
        const oldHash = this.spaceSnapshot[meta.name];
        const newHash = meta.lastModified;
        // Update in snapshot
        this.updateInSnapshot(meta.name, newHash);

        // Check what happened to the file
        if (
          // New file scenario
          !oldHash ||
          // Changed file scenario
          (oldHash && oldHash !== newHash)
        ) {
          console.log(
            "Detected file change during listing",
            meta.name,
            oldHash,
            newHash,
          );
          await this.dispatchEvent("file:changed", meta.name, oldHash, newHash);
        }
        // Page found, not deleted
        deletedFiles.delete(meta.name);
      }

      for (const deletedFile of deletedFiles) {
        this.deleteFromSnapshot(deletedFile);
        await this.dispatchEvent("file:deleted", deletedFile);

        if (deletedFile.endsWith(".md")) {
          const pageName = deletedFile.substring(0, deletedFile.length - 3);
          await this.dispatchEvent("page:deleted", pageName);
        }
      }

      await this.dispatchEvent("file:listed", newFileList);
      return newFileList;
    } finally {
      await this.saveSnapshot();
      this.operationCount--;
    }
  }

  async readFile(path: string): Promise<{ data: Uint8Array; meta: FileMeta }> {
    if (!this.enabled) {
      return this.wrapped.readFile(path);
    }
    this.operationCount++;
    try {
      // Fetch file
      const data = await this.wrapped.readFile(path);
      if (this.operationCount === 1) {
        await this.triggerEventsAndCache(path, data.meta.lastModified);
      }
      return data;
    } finally {
      this.operationCount--;
      this.checkDeferredFetchFileList();
    }
  }

  async writeFile(
    path: string,
    data: Uint8Array,
    meta?: FileMeta,
  ): Promise<FileMeta> {
    if (!this.enabled) {
      return this.wrapped.writeFile(path, data, meta);
    }

    this.operationCount++;
    try {
      const newMeta = await this.wrapped.writeFile(path, data, meta);
      if (this.operationCount === 1) {
        await this.triggerEventsAndCache(path, newMeta.lastModified);
      }
      if (path.endsWith(".md")) {
        const pageName = path.substring(0, path.length - 3);
        await this.dispatchEvent("page:saved", pageName, newMeta);
      }

      return newMeta;
    } finally {
      this.operationCount--;
      this.checkDeferredFetchFileList();
    }
  }

  /**
   * @param name
   * @param newHash
   * @return whether something changed in the snapshot
   */
  async triggerEventsAndCache(name: string, newHash: number) {
    const oldHash = this.spaceSnapshot[name];
    // if (oldHash && newHash && oldHash !== newHash) {
    if (oldHash !== newHash) {
      // Page changed since last cached metadata, trigger event
      await this.dispatchEvent("file:changed", name, oldHash, newHash);
    }
    this.updateInSnapshot(name, newHash);
    await this.saveSnapshot();
  }

  async getFileMeta(path: string, observing?: boolean): Promise<FileMeta> {
    if (!this.enabled) {
      return this.wrapped.getFileMeta(path, observing);
    }

    this.operationCount++;
    try {
      const newMeta = await this.wrapped.getFileMeta(path, observing);
      if (this.operationCount === 1) {
        await this.triggerEventsAndCache(path, newMeta.lastModified);
      }
      return newMeta;
    } finally {
      this.operationCount--;
      this.checkDeferredFetchFileList();
    }
  }

  async deleteFile(path: string): Promise<void> {
    if (!this.enabled) {
      return this.wrapped.deleteFile(path);
    }

    this.operationCount++;
    try {
      if (path.endsWith(".md")) {
        const pageName = path.substring(0, path.length - 3);
        await this.dispatchEvent("page:deleted", pageName);
      }
      await this.wrapped.deleteFile(path);
      this.deleteFromSnapshot(path);
      await this.dispatchEvent("file:deleted", path);
    } finally {
      await this.saveSnapshot();
      this.operationCount--;
      this.checkDeferredFetchFileList();
    }
  }
}
