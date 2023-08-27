import { FileMeta } from "$sb/types.ts";
import { EventHook } from "../../plugos/hooks/event.ts";

import type { SpacePrimitives } from "./space_primitives.ts";

/**
 * Events exposed:
 * - file:changed (FileMeta)
 * - file:deleted (string)
 * - file:listed (FileMeta[])
 * - page:saved (string, FileMeta)
 * - page:deleted (string)
 */

export class EventedSpacePrimitives implements SpacePrimitives {
  private fileMetaCache = new Map<string, FileMeta>();
  initialFileListLoad = true;

  constructor(
    private wrapped: SpacePrimitives,
    private eventHook: EventHook,
    private eventsToDispatch = [
      "file:changed",
      "file:deleted",
      "file:listed",
      "page:saved",
      "page:deleted",
    ],
  ) {}

  dispatchEvent(name: string, ...args: any[]): Promise<any[]> {
    if (this.eventsToDispatch.includes(name)) {
      return this.eventHook.dispatchEvent(name, ...args);
    } else {
      return Promise.resolve([]);
    }
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const newFileList = await this.wrapped.fetchFileList();
    const deletedFiles = new Set<string>(this.fileMetaCache.keys());
    for (const meta of newFileList) {
      const oldFileMeta = this.fileMetaCache.get(meta.name);
      const newFileMeta: FileMeta = { ...meta };
      if (
        (
          // New file scenario
          !oldFileMeta && !this.initialFileListLoad
        ) || (
          // Changed file scenario
          oldFileMeta &&
          oldFileMeta.lastModified !== newFileMeta.lastModified
        )
      ) {
        this.dispatchEvent("file:changed", newFileMeta);
      }
      // Page found, not deleted
      deletedFiles.delete(meta.name);

      // Update in cache
      this.fileMetaCache.set(meta.name, newFileMeta);
    }

    for (const deletedFile of deletedFiles) {
      this.fileMetaCache.delete(deletedFile);
      this.dispatchEvent("file:deleted", deletedFile);

      if (deletedFile.endsWith(".md")) {
        const pageName = deletedFile.substring(0, deletedFile.length - 3);
        await this.dispatchEvent("page:deleted", pageName);
      }
    }

    const fileList = [...new Set(this.fileMetaCache.values())];
    this.dispatchEvent("file:listed", fileList);
    this.initialFileListLoad = false;
    return fileList;
  }

  async readFile(
    name: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta }> {
    const data = await this.wrapped.readFile(name);
    const previousMeta = this.fileMetaCache.get(name);
    const newMeta = data.meta;
    if (previousMeta) {
      if (previousMeta.lastModified !== newMeta.lastModified) {
        // Page changed since last cached metadata, trigger event
        this.dispatchEvent("file:changed", newMeta);
      }
    }
    return {
      data: data.data,
      meta: this.metaCacher(name, newMeta),
    };
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
      this.dispatchEvent("file:changed", newMeta);
    }
    this.metaCacher(name, newMeta);

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
    if (name.startsWith("_plug/") && name.endsWith(".plug.js")) {
      await this.dispatchEvent("plug:changed", name);
    }
    return newMeta;
  }

  async getFileMeta(name: string): Promise<FileMeta> {
    try {
      const oldMeta = this.fileMetaCache.get(name);
      const newMeta = await this.wrapped.getFileMeta(name);
      if (oldMeta) {
        if (oldMeta.lastModified !== newMeta.lastModified) {
          // Changed on disk, trigger event
          this.dispatchEvent("file:changed", newMeta);
        }
      }
      return this.metaCacher(name, newMeta);
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
    this.fileMetaCache.delete(name);
    this.dispatchEvent("file:deleted", name);
  }

  private metaCacher(name: string, meta: FileMeta): FileMeta {
    if (meta.lastModified !== 0) {
      // Don't cache metadata for pages with a 0 lastModified timestamp (usualy dynamically generated pages)
      this.fileMetaCache.set(name, meta);
    }
    return meta;
  }
}
