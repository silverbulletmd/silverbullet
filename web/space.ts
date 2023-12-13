import { SpacePrimitives } from "../common/spaces/space_primitives.ts";
import { plugPrefix } from "../common/spaces/constants.ts";
import { safeRun } from "../common/util.ts";

import { AttachmentMeta, FileMeta, PageMeta } from "$sb/types.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { throttle } from "$sb/lib/async.ts";
import { DataStore } from "../plugos/lib/datastore.ts";
import { LimitedMap } from "../common/limited_map.ts";

const pageWatchInterval = 5000;

export class Space {
  imageHeightCache = new LimitedMap<number>(100); // url -> height
  widgetHeightCache = new LimitedMap<number>(100); // bodytext -> height
  cachedPageList: PageMeta[] = [];

  debouncedImageCacheFlush = throttle(() => {
    this.ds.set(["cache", "imageHeight"], this.imageHeightCache).catch(
      console.error,
    );
    console.log("Flushed image height cache to store");
  }, 5000);

  setCachedImageHeight(url: string, height: number) {
    this.imageHeightCache.set(url, height);
    this.debouncedImageCacheFlush();
  }
  getCachedImageHeight(url: string): number {
    return this.imageHeightCache.get(url) ?? -1;
  }

  debouncedWidgetCacheFlush = throttle(() => {
    this.ds.set(["cache", "widgetHeight"], this.widgetHeightCache.toJSON())
      .catch(
        console.error,
      );
    // console.log("Flushed widget height cache to store");
  }, 5000);

  setCachedWidgetHeight(bodyText: string, height: number) {
    this.widgetHeightCache.set(bodyText, height);
    this.debouncedWidgetCacheFlush();
  }
  getCachedWidgetHeight(bodyText: string): number {
    return this.widgetHeightCache.get(bodyText) ?? -1;
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
    this.ds.batchGet([["cache", "imageHeight"], ["cache", "widgetHeight"]])
      .then(([imageCache, widgetCache]) => {
        if (imageCache) {
          this.imageHeightCache = new LimitedMap(100, imageCache);
        }
        if (widgetCache) {
          // console.log("Loaded widget cache from store", widgetCache);
          this.widgetHeightCache = new LimitedMap(100, widgetCache);
        }
      });
    eventHook.addLocalListener("file:listed", (files: FileMeta[]) => {
      // console.log("Files listed", files);
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

  async listPlugs(): Promise<FileMeta[]> {
    const files = await this.deduplicatedFileList();
    return files
      .filter((fileMeta) =>
        fileMeta.name.startsWith(plugPrefix) &&
        fileMeta.name.endsWith(".plug.js")
      );
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
      const pageMeta = fileMetaToPageMeta(
        await this.spacePrimitives.writeFile(
          `${name}.md`,
          new TextEncoder().encode(text),
          selfUpdate,
        ),
      );
      if (!this.cachedPageList.find((page) => page.name === pageMeta.name)) {
        // New page, let's cache it
        this.cachedPageList.push(pageMeta);
      }
      // Note: we don't do very elaborate cache invalidation work here, quite quickly the cache will be flushed anyway
      return pageMeta;
    } finally {
      this.saving = false;
    }
  }

  // We're listing all pages that don't start with a _
  isListedPage(fileMeta: FileMeta): boolean {
    return fileMeta.name.endsWith(".md") && !fileMeta.name.startsWith("_");
  }

  async fetchPageList(): Promise<PageMeta[]> {
    return (await this.deduplicatedFileList())
      .filter(this.isListedPage)
      .map(fileMetaToPageMeta);
  }

  async fetchAttachmentList(): Promise<AttachmentMeta[]> {
    return (await this.deduplicatedFileList()).filter(
      (fileMeta) =>
        !this.isListedPage(fileMeta) &&
        !fileMeta.name.endsWith(".plug.js"),
    );
  }

  async deduplicatedFileList(): Promise<FileMeta[]> {
    const files = await this.spacePrimitives.fetchFileList();
    const fileMap = new Map<string, FileMeta>();
    for (const file of files) {
      if (fileMap.has(file.name)) {
        const existing = fileMap.get(file.name)!;
        if (existing.lastModified < file.lastModified) {
          fileMap.set(file.name, file);
        }
      } else {
        fileMap.set(file.name, file);
      }
    }
    return [...fileMap.values()];
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
  const name = fileMeta.name.substring(0, fileMeta.name.length - 3);
  try {
    return {
      ...fileMeta,
      ref: name,
      tags: ["page"],
      name,
      created: new Date(fileMeta.created).toISOString(),
      lastModified: new Date(fileMeta.lastModified).toISOString(),
    } as PageMeta;
  } catch (e) {
    console.error("Failed to convert fileMeta to pageMeta", fileMeta, e);
    throw e;
  }
}
