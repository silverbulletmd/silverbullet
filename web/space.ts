import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { plugPrefix } from "../common/spaces/constants.ts";
import { safeRun } from "../common/util.ts";

import { AttachmentMeta, FileMeta, PageMeta } from "$sb/types.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { throttle } from "$sb/lib/async.ts";
import { DataStore } from "../plugos/lib/datastore.ts";

const pageWatchInterval = 5000;

export class Space {
  imageHeightCache: Record<string, number> = {};
  // pageMetaCache = new Map<string, PageMeta>();
  cachedPageList: PageMeta[] = [];

  debouncedCacheFlush = throttle(() => {
    this.ds.set(["cache", "imageHeight"], this.imageHeightCache).catch(
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

  // private initialPageListLoad = true;
  private saving = false;

  constructor(
    readonly spacePrimitives: SpacePrimitives,
    private ds: DataStore,
    private eventHook: EventHook,
  ) {
    // super();
    this.ds.get(["cache", "imageHeight"]).then((cache) => {
      if (cache) {
        // console.log("Loaded image height cache from KV store", cache);
        this.imageHeightCache = cache;
      }
    });
    eventHook.addLocalListener("file:listed", (files: FileMeta[]) => {
      this.cachedPageList = files.filter(this.isListedPage).map(
        fileMetaToPageMeta,
      );
    });
    eventHook.addLocalListener("page:deleted", (pageName: string) => {
      if (this.watchedPages.has(pageName)) {
        // Stop watching deleted pages already
        this.watchedPages.delete(pageName);
      }
    });
  }

  public async updatePageList() {
    // This will trigger appropriate events automatically
    await this.fetchPageList();
  }

  async deletePage(name: string): Promise<void> {
    await this.getPageMeta(name); // Check if page exists, if not throws Error
    await this.spacePrimitives.deleteFile(`${name}.md`);
  }

  async getPageMeta(name: string): Promise<PageMeta> {
    return fileMetaToPageMeta(
      await this.spacePrimitives.getFileMeta(`${name}.md`),
    );
  }

  listPages(): PageMeta[] {
    return this.cachedPageList;
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
    return {
      text: new TextDecoder().decode(pageData.data),
      meta: fileMetaToPageMeta(pageData.meta),
    };
  }

  async writePage(
    name: string,
    text: string,
    selfUpdate?: boolean,
  ): Promise<PageMeta> {
    try {
      this.saving = true;
      return fileMetaToPageMeta(
        await this.spacePrimitives.writeFile(
          `${name}.md`,
          new TextEncoder().encode(text),
          selfUpdate,
        ),
      );
    } finally {
      this.saving = false;
    }
  }

  // We're listing all pages that don't start with a _
  isListedPage(fileMeta: FileMeta): boolean {
    return fileMeta.name.endsWith(".md") && !fileMeta.name.startsWith("_");
  }

  async fetchPageList(): Promise<PageMeta[]> {
    return (await this.spacePrimitives.fetchFileList())
      .filter(this.isListedPage)
      .map(fileMetaToPageMeta);
  }

  async fetchAttachmentList(): Promise<AttachmentMeta[]> {
    return (await this.spacePrimitives.fetchFileList()).filter(
      (fileMeta) =>
        !this.isListedPage(fileMeta) &&
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
    selfUpdate?: boolean,
  ): Promise<AttachmentMeta> {
    return this.spacePrimitives.writeFile(name, data, selfUpdate);
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
}

export function fileMetaToPageMeta(fileMeta: FileMeta): PageMeta {
  return {
    ...fileMeta,
    name: fileMeta.name.substring(0, fileMeta.name.length - 3),
  } as PageMeta;
}
