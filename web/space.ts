import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { FileMeta } from "../common/types.ts";
import { EventEmitter } from "../plugos/event.ts";
import { plugPrefix } from "../common/spaces/constants.ts";
import { safeRun } from "../common/util.ts";
import { AttachmentMeta, PageMeta } from "./types.ts";
import { DexieKVStore } from "../plugos/lib/kv_store.dexie.ts";
import { throttle } from "../common/async_util.ts";

export type SpaceEvents = {
  pageCreated: (meta: PageMeta) => void;
  pageChanged: (meta: PageMeta) => void;
  pageDeleted: (name: string) => void;
  pageListUpdated: (pages: PageMeta[]) => void;
};

const pageWatchInterval = 5000;

export class Space extends EventEmitter<SpaceEvents> {
  pageMetaCache = new Map<string, PageMeta>();

  imageHeightCache: Record<string, number> = {};

  debouncedCacheFlush = throttle(() => {
    this.kvStore.set("imageHeightCache", this.imageHeightCache).catch(
      console.error,
    );
    console.log("Flushed image height cache to store");
  }, 5000);

  setCachedImageHeight(url: string, height: number) {
    this.imageHeightCache[url] = height;
    this.debouncedCacheFlush();
  }
  getCachedImageHeight(url: string): number {
    return this.imageHeightCache[url] ?? -1;
  }

  // We do watch files in the background to detect changes
  // This set of pages should only ever contain 1 page
  watchedPages = new Set<string>();
  watchInterval?: number;

  private initialPageListLoad = true;
  private saving = false;

  constructor(
    readonly spacePrimitives: SpacePrimitives,
    private kvStore: DexieKVStore,
  ) {
    super();
    this.kvStore.get("imageHeightCache").then((cache) => {
      if (cache) {
        console.log("Loaded image height cache from KV store", cache);
        this.imageHeightCache = cache;
      }
    });
  }

  public async updatePageList() {
    const newPageList = await this.fetchPageList();
    const deletedPages = new Set<string>(this.pageMetaCache.keys());
    newPageList.forEach((meta) => {
      const pageName = meta.name;
      const oldPageMeta = this.pageMetaCache.get(pageName);
      const newPageMeta: PageMeta = { ...meta };
      if (
        !oldPageMeta &&
        (pageName.startsWith(plugPrefix) || !this.initialPageListLoad)
      ) {
        this.emit("pageCreated", newPageMeta);
      } else if (
        oldPageMeta &&
        oldPageMeta.lastModified !== newPageMeta.lastModified
      ) {
        this.emit("pageChanged", newPageMeta);
      }
      // Page found, not deleted
      deletedPages.delete(pageName);

      // Update in cache
      this.pageMetaCache.set(pageName, newPageMeta);
    });

    for (const deletedPage of deletedPages) {
      this.pageMetaCache.delete(deletedPage);
      this.emit("pageDeleted", deletedPage);
    }

    this.emit("pageListUpdated", this.listPages());
    this.initialPageListLoad = false;
  }

  async deletePage(name: string): Promise<void> {
    await this.getPageMeta(name); // Check if page exists, if not throws Error
    await this.spacePrimitives.deleteFile(`${name}.md`);

    this.pageMetaCache.delete(name);
    this.emit("pageDeleted", name);
    this.emit("pageListUpdated", [...this.pageMetaCache.values()]);
  }

  async getPageMeta(name: string): Promise<PageMeta> {
    const oldMeta = this.pageMetaCache.get(name);
    const newMeta = fileMetaToPageMeta(
      await this.spacePrimitives.getFileMeta(`${name}.md`),
    );
    if (oldMeta) {
      if (oldMeta.lastModified !== newMeta.lastModified) {
        // Changed on disk, trigger event
        this.emit("pageChanged", newMeta);
      }
    }
    return this.metaCacher(name, newMeta);
  }

  listPages(): PageMeta[] {
    return [...new Set(this.pageMetaCache.values())];
  }

  async listPlugs(): Promise<string[]> {
    const files = await this.spacePrimitives.fetchFileList();
    return files
      .filter((fileMeta) =>
        fileMeta.name.startsWith(plugPrefix) &&
        fileMeta.name.endsWith(".plug.js")
      )
      .map((fileMeta) => fileMeta.name);
  }

  async readPage(name: string): Promise<{ text: string; meta: PageMeta }> {
    const pageData = await this.spacePrimitives.readFile(`${name}.md`);
    const previousMeta = this.pageMetaCache.get(name);
    const newMeta = fileMetaToPageMeta(pageData.meta);
    if (previousMeta) {
      if (previousMeta.lastModified !== newMeta.lastModified) {
        // Page changed since last cached metadata, trigger event
        this.emit("pageChanged", newMeta);
      }
    }
    const meta = this.metaCacher(name, newMeta);
    return {
      text: new TextDecoder().decode(pageData.data),
      meta: meta,
    };
  }

  async writePage(
    name: string,
    text: string,
    selfUpdate?: boolean,
  ): Promise<PageMeta> {
    try {
      this.saving = true;
      const pageMeta = fileMetaToPageMeta(
        await this.spacePrimitives.writeFile(
          `${name}.md`,
          new TextEncoder().encode(text),
          selfUpdate,
        ),
      );
      if (!selfUpdate) {
        this.emit("pageChanged", pageMeta);
      }
      return this.metaCacher(name, pageMeta);
    } finally {
      this.saving = false;
    }
  }

  async fetchPageList(): Promise<PageMeta[]> {
    return (await this.spacePrimitives.fetchFileList())
      .filter((fileMeta) => fileMeta.name.endsWith(".md"))
      .map(fileMetaToPageMeta);
  }

  async fetchAttachmentList(): Promise<AttachmentMeta[]> {
    return (await this.spacePrimitives.fetchFileList()).filter(
      (fileMeta) =>
        !fileMeta.name.endsWith(".md") &&
        !fileMeta.name.endsWith(".plug.js"),
    );
  }

  /**
   * Reads an attachment
   * @param name path of the attachment
   * @returns
   */
  readAttachment(
    name: string,
  ): Promise<{ data: Uint8Array; meta: AttachmentMeta }> {
    return this.spacePrimitives.readFile(name);
  }

  getAttachmentMeta(name: string): Promise<AttachmentMeta> {
    return this.spacePrimitives.getFileMeta(name);
  }

  writeAttachment(
    name: string,
    data: Uint8Array,
    selfUpdate?: boolean | undefined,
  ): Promise<AttachmentMeta> {
    return this.spacePrimitives.writeFile(
      name,
      data as Uint8Array,
      selfUpdate,
    );
  }

  deleteAttachment(name: string): Promise<void> {
    return this.spacePrimitives.deleteFile(name);
  }

  // Even though changes coming from a sync cycle will immediately trigger a reload
  // there are scenarios in which other tabs run the sync, so we have to poll for changes
  watch() {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
    }
    this.watchInterval = setInterval(() => {
      safeRun(async () => {
        if (this.saving) {
          return;
        }
        for (const pageName of this.watchedPages) {
          const oldMeta = this.pageMetaCache.get(pageName);
          if (!oldMeta) {
            // No longer in cache, meaning probably deleted let's unwatch
            this.watchedPages.delete(pageName);
            continue;
          }
          // This seems weird, but simply fetching it will compare to local cache and trigger an event if necessary
          await this.getPageMeta(pageName);
        }
      });
    }, pageWatchInterval);
    this.updatePageList().catch(console.error);
  }

  unwatch() {
    if (this.watchInterval) {
      clearInterval(this.watchInterval);
    }
  }

  watchPage(pageName: string) {
    this.watchedPages.add(pageName);
  }

  unwatchPage(pageName: string) {
    this.watchedPages.delete(pageName);
  }

  private metaCacher(name: string, meta: PageMeta): PageMeta {
    if (meta.lastModified !== 0) {
      // Don't cache metadata for pages with a 0 lastModified timestamp (usualy dynamically generated pages)
      this.pageMetaCache.set(name, meta);
    }
    return meta;
  }
}

function fileMetaToPageMeta(fileMeta: FileMeta): PageMeta {
  return {
    ...fileMeta,
    name: fileMeta.name.substring(0, fileMeta.name.length - 3),
  } as PageMeta;
}
