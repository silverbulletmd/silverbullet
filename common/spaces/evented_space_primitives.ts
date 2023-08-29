import { FileMeta } from "$sb/types.ts";
import { EventHook } from "../../plugos/hooks/event.ts";

import type { SpacePrimitives } from "./space_primitives.ts";

/**
 * Events exposed:
 * - file:changed (string, localUpdate: boolean)
 * - file:deleted (string)
 * - file:listed (FileMeta[])
 * - page:saved (string, FileMeta)
 * - page:deleted (string)
 */
export class EventedSpacePrimitives implements SpacePrimitives {
  alreadyFetching = false;
  initialFileListLoad = true;

  spaceSnapshot: Record<string, number> = {};
  constructor(
    private wrapped: SpacePrimitives,
    private eventHook: EventHook,
  ) {}

  dispatchEvent(name: string, ...args: any[]): Promise<any[]> {
    return this.eventHook.dispatchEvent(name, ...args);
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const newFileList = await this.wrapped.fetchFileList();
    if (this.alreadyFetching) {
      // Avoid race conditions
      return newFileList;
    }
    // console.log("HEREEREEEREEREE");
    this.alreadyFetching = true;
    const deletedFiles = new Set<string>(Object.keys(this.spaceSnapshot));
    for (const meta of newFileList) {
      const oldHash = this.spaceSnapshot[meta.name];
      const newHash = meta.lastModified;
      if (
        (
          // New file scenario
          !oldHash && !this.initialFileListLoad
        ) || (
          // Changed file scenario
          oldHash &&
          oldHash !== newHash
        )
      ) {
        this.dispatchEvent("file:changed", meta.name);
      }
      // Page found, not deleted
      deletedFiles.delete(meta.name);

      // Update in snapshot
      this.spaceSnapshot[meta.name] = newHash;
    }

    for (const deletedFile of deletedFiles) {
      delete this.spaceSnapshot[deletedFile];
      this.dispatchEvent("file:deleted", deletedFile);

      if (deletedFile.endsWith(".md")) {
        const pageName = deletedFile.substring(0, deletedFile.length - 3);
        await this.dispatchEvent("page:deleted", pageName);
      }
    }

    this.dispatchEvent("file:listed", newFileList);
    this.alreadyFetching = false;
    this.initialFileListLoad = false;
    return newFileList;
  }

  async readFile(
    name: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    const data = await this.wrapped.readFile(name);
    this.triggerEventsAndCache(name, data.meta.lastModified);
    return data;
  }

  async writeFile(
    name: string,
    data: Uint8Array,
    selfUpdate?: boolean,
    meta?: FileMeta,
  ): Promise<FileMeta> {
    const newMeta = await this.wrapped.writeFile(
      name,
      data,
      selfUpdate,
      meta,
    );
    if (!selfUpdate) {
      this.dispatchEvent("file:changed", name, true);
    }
    this.spaceSnapshot[name] = newMeta.lastModified;

    // This can happen async
    if (name.endsWith(".md")) {
      const pageName = name.substring(0, name.length - 3);
      let text = "";
      const decoder = new TextDecoder("utf-8");
      text = decoder.decode(data);

      this.dispatchEvent("page:saved", pageName, newMeta)
        .then(() => {
          return this.dispatchEvent("page:index_text", {
            name: pageName,
            text,
          });
        })
        .catch((e) => {
          console.error("Error dispatching page:saved event", e);
        });
    }
    // if (name.startsWith("_plug/") && name.endsWith(".plug.js")) {
    //   await this.dispatchEvent("plug:changed", name);
    // }
    return newMeta;
  }

  triggerEventsAndCache(name: string, newHash: number) {
    const oldHash = this.spaceSnapshot[name];
    if (oldHash && oldHash !== newHash) {
      // Page changed since last cached metadata, trigger event
      this.dispatchEvent("file:changed", name);
    }
    this.spaceSnapshot[name] = newHash;
    return;
  }

  async getFileMeta(name: string): Promise<FileMeta> {
    try {
      const newMeta = await this.wrapped.getFileMeta(name);
      this.triggerEventsAndCache(name, newMeta.lastModified);
      return newMeta;
    } catch (e: any) {
      console.log("Checking error", e, name);
      if (e.message === "Not found") {
        this.dispatchEvent("file:deleted", name);
        if (name.endsWith(".md")) {
          const pageName = name.substring(0, name.length - 3);
          await this.dispatchEvent("page:deleted", pageName);
        }
      }
      throw e;
    }
  }

  async deleteFile(name: string): Promise<void> {
    if (name.endsWith(".md")) {
      const pageName = name.substring(0, name.length - 3);
      await this.dispatchEvent("page:deleted", pageName);
    }
    // await this.getPageMeta(name); // Check if page exists, if not throws Error
    await this.wrapped.deleteFile(name);
    delete this.spaceSnapshot[name];
    this.dispatchEvent("file:deleted", name);
  }
}
