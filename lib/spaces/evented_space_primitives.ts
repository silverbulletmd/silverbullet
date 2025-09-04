import type { EventHook } from "../../web/hooks/event.ts";

import type { SpacePrimitives } from "./space_primitives.ts";
import type { FileMeta } from "../../type/index.ts";
import type { DataStore } from "../data/datastore.ts";
import { notFoundError } from "../constants.ts";

/**
 * Events exposed:
 * - file:changed (string, localUpdate: boolean, oldHash, newHash)
 * - file:deleted (string)
 * - file:listed (FileMeta[])
 * - file:initial: triggered in case of an initially empty snapshot, after the first set of events has gone out
 * - page:deleted (string)
 */
export class EventedSpacePrimitives implements SpacePrimitives {
  // Various operations may be going on at the same time, and we don't want to trigger events unnessarily.
  // Therefore, we use this variable to track if any operation is in flight, and if so, we skip event triggering.
  // This is ok, because any event will be picked up in a following iteration.
  operationInProgress = false;

  private spaceSnapshot: Record<string, number> = {};

  private enabled = false;

  constructor(
    private wrapped: SpacePrimitives,
    private eventHook: EventHook,
    private ds: DataStore,
    private snapshotKey = ["$spaceSnapshot"],
  ) {
  }

  async enable() {
    console.log("Loading snapshot and enabling events");
    this.spaceSnapshot = (await this.ds.get(this.snapshotKey)) || {};
    const isFreshSnapshot = Object.keys(this.spaceSnapshot).length === 0;
    this.enabled = true;
    // trigger loading and eventing
    this.fetchFileList().then(async () => {
      if (isFreshSnapshot) {
        // Trigger event to signal that an intial batch of events has been triggere
        await this.dispatchEvent("file:initial");
      }
    });
  }

  private async saveSnapshot() {
    if (this.enabled) {
      console.log("Saving snapshot");
      await this.ds.set(this.snapshotKey, this.spaceSnapshot);
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
    if (this.operationInProgress) {
      // Some other operation (read, write, list, meta) is already going on
      // this will likely trigger events, so let's not worry about any of that and avoid race condition and inconsistent data.
      console.info(
        "alreadyFetching is on, skipping even triggering for fetchFileList.",
      );
      return this.wrapped.fetchFileList();
    }
    if (!this.enabled) {
      return this.wrapped.fetchFileList();
    }
    // console.log("Fetching file list");
    // Fetching mutex
    this.operationInProgress = true;
    try {
      // Fetch the list
      const newFileList = await this.wrapped.fetchFileList();

      // Now we have the list, let's compare it to the snapshot and trigger events appropriately
      const deletedFiles = new Set<string>(Object.keys(this.spaceSnapshot));
      for (const meta of newFileList) {
        const oldHash = this.spaceSnapshot[meta.name];
        const newHash = meta.lastModified;
        // Update in snapshot
        this.spaceSnapshot[meta.name] = newHash;

        // Check what happened to the file
        if (
          (
            // New file scenario
            !oldHash
          ) || (
            // Changed file scenario
            oldHash &&
            oldHash !== newHash
          )
        ) {
          console.log("Detected file change", meta.name, oldHash, newHash);
          await this.dispatchEvent(
            "file:changed",
            meta.name,
            false,
            oldHash,
            newHash,
          );
        }
        // Page found, not deleted
        deletedFiles.delete(meta.name);
      }

      for (const deletedFile of deletedFiles) {
        delete this.spaceSnapshot[deletedFile];
        await this.dispatchEvent("file:deleted", deletedFile);

        if (deletedFile.endsWith(".md")) {
          const pageName = deletedFile.substring(0, deletedFile.length - 3);
          await this.dispatchEvent("page:deleted", pageName);
        }
      }

      await this.dispatchEvent("file:listed", newFileList);
      // this.initialFileListLoad = false;
      return newFileList;
    } finally {
      await this.saveSnapshot();
      this.operationInProgress = false;
    }
  }

  async readFile(
    path: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    if (!this.enabled) {
      return this.wrapped.readFile(path);
    }
    try {
      // Fetching mutex
      const wasFetching = this.operationInProgress;
      this.operationInProgress = true;

      // Fetch file
      const data = await this.wrapped.readFile(path);
      if (!wasFetching) {
        if (this.triggerEventsAndCache(path, data.meta.lastModified)) {
          // Something changed, so persist snapshot
          await this.saveSnapshot();
        }
      }
      return data;
    } finally {
      this.operationInProgress = false;
    }
  }

  async writeFile(
    path: string,
    data: Uint8Array,
    // TODO: Is self update still used or can it now be removed?
    selfUpdate?: boolean,
    meta?: FileMeta,
  ): Promise<FileMeta> {
    if (!this.enabled) {
      return this.wrapped.writeFile(path, data, selfUpdate, meta);
    }

    const wasFetching = this.operationInProgress;
    this.operationInProgress = true;
    try {
      const newMeta = await this.wrapped.writeFile(
        path,
        data,
        selfUpdate,
        meta,
      );
      if (!wasFetching) {
        if (this.triggerEventsAndCache(path, newMeta.lastModified)) {
          await this.saveSnapshot();
        }
      }
      return newMeta;
    } finally {
      this.operationInProgress = false;
    }
  }

  /**
   * @param name
   * @param newHash
   * @return whether something changed in the snapshot
   */
  triggerEventsAndCache(name: string, newHash: number): boolean {
    const oldHash = this.spaceSnapshot[name];
    if (oldHash && newHash && oldHash !== newHash) {
      // Page changed since last cached metadata, trigger event
      this.dispatchEvent("file:changed", name, false, oldHash, newHash);
    }
    this.spaceSnapshot[name] = newHash;
    return oldHash !== newHash;
  }

  async getFileMeta(path: string, observing?: boolean): Promise<FileMeta> {
    if (!this.enabled) {
      return this.wrapped.getFileMeta(path, observing);
    }

    try {
      const wasFetching = this.operationInProgress;
      this.operationInProgress = true;
      const newMeta = await this.wrapped.getFileMeta(path, observing);
      if (!wasFetching) {
        if (this.triggerEventsAndCache(path, newMeta.lastModified)) {
          await this.saveSnapshot();
        }
      }
      return newMeta;
    } catch (e: any) {
      // console.log("Checking error", e, path);
      if (e.message === notFoundError.message) {
        await this.dispatchEvent("file:deleted", path);
        if (path.endsWith(".md")) {
          const pageName = path.substring(0, path.length - 3);
          await this.dispatchEvent("page:deleted", pageName);
        }
      }
      throw e;
    } finally {
      this.operationInProgress = false;
    }
  }

  async deleteFile(path: string): Promise<void> {
    if (!this.enabled) {
      return this.wrapped.deleteFile(path);
    }

    try {
      this.operationInProgress = true;
      if (path.endsWith(".md")) {
        const pageName = path.substring(0, path.length - 3);
        await this.dispatchEvent("page:deleted", pageName);
      }
      // await this.getPageMeta(path); // Check if page exists, if not throws Error
      await this.wrapped.deleteFile(path);
      delete this.spaceSnapshot[path];
      await this.dispatchEvent("file:deleted", path);
    } finally {
      await this.saveSnapshot();
      this.operationInProgress = false;
    }
  }
}
