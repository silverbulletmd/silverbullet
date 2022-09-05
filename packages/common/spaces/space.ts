import { SpacePrimitives } from "./space_primitives";
import { AttachmentMeta, PageMeta } from "../types";
import { EventEmitter } from "@plugos/plugos/event";
import { Plug } from "@plugos/plugos/plug";
import { Manifest } from "../manifest";
import { plugPrefix, trashPrefix } from "./constants";
import { safeRun } from "../util";

const pageWatchInterval = 2000;

export type SpaceEvents = {
  pageCreated: (meta: PageMeta) => void;
  pageChanged: (meta: PageMeta) => void;
  pageDeleted: (name: string) => void;
  pageListUpdated: (pages: Set<PageMeta>) => void;
};

export class Space
  extends EventEmitter<SpaceEvents>
  implements SpacePrimitives
{
  pageMetaCache = new Map<string, PageMeta>();
  watchedPages = new Set<string>();
  private initialPageListLoad = true;
  private saving = false;

  constructor(private space: SpacePrimitives, private trashEnabled = true) {
    super();
  }

  public async updatePageList() {
    let newPageList = await this.space.fetchPageList();
    let deletedPages = new Set<string>(this.pageMetaCache.keys());
    newPageList.pages.forEach((meta) => {
      const pageName = meta.name;
      const oldPageMeta = this.pageMetaCache.get(pageName);
      const newPageMeta: PageMeta = {
        name: pageName,
        lastModified: meta.lastModified,
        perm: meta.perm,
      };
      if (
        !oldPageMeta &&
        (pageName.startsWith(plugPrefix) || !this.initialPageListLoad)
      ) {
        this.emit("pageCreated", newPageMeta);
      } else if (
        oldPageMeta &&
        oldPageMeta.lastModified !== newPageMeta.lastModified &&
        (!this.trashEnabled ||
          (this.trashEnabled && !pageName.startsWith(trashPrefix)))
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

  watch() {
    setInterval(() => {
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

  async deletePage(name: string, deleteDate?: number): Promise<void> {
    await this.getPageMeta(name); // Check if page exists, if not throws Error
    if (this.trashEnabled) {
      let pageData = await this.readPage(name);
      // Move to trash
      await this.writePage(
        `${trashPrefix}${name}`,
        pageData.text,
        true,
        deleteDate
      );
    }
    await this.space.deletePage(name);

    this.pageMetaCache.delete(name);
    this.emit("pageDeleted", name);
    this.emit("pageListUpdated", new Set([...this.pageMetaCache.values()]));
  }

  async getPageMeta(name: string): Promise<PageMeta> {
    let oldMeta = this.pageMetaCache.get(name);
    let newMeta = await this.space.getPageMeta(name);
    if (oldMeta) {
      if (oldMeta.lastModified !== newMeta.lastModified) {
        // Changed on disk, trigger event
        this.emit("pageChanged", newMeta);
      }
    }
    return this.metaCacher(name, newMeta);
  }

  invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[]
  ): Promise<any> {
    return this.space.invokeFunction(plug, env, name, args);
  }

  listPages(unfiltered = false): Set<PageMeta> {
    if (unfiltered) {
      return new Set(this.pageMetaCache.values());
    } else {
      return new Set(
        [...this.pageMetaCache.values()].filter(
          (pageMeta) =>
            !pageMeta.name.startsWith(trashPrefix) &&
            !pageMeta.name.startsWith(plugPrefix)
        )
      );
    }
  }

  listTrash(): Set<PageMeta> {
    return new Set(
      [...this.pageMetaCache.values()]
        .filter(
          (pageMeta) =>
            pageMeta.name.startsWith(trashPrefix) &&
            !pageMeta.name.startsWith(plugPrefix)
        )
        .map((pageMeta) => ({
          ...pageMeta,
          name: pageMeta.name.substring(trashPrefix.length),
        }))
    );
  }

  listPlugs(): Set<PageMeta> {
    return new Set(
      [...this.pageMetaCache.values()].filter((pageMeta) =>
        pageMeta.name.startsWith(plugPrefix)
      )
    );
  }

  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any> {
    return this.space.proxySyscall(plug, name, args);
  }

  async readPage(name: string): Promise<{ text: string; meta: PageMeta }> {
    let pageData = await this.space.readPage(name);
    let previousMeta = this.pageMetaCache.get(name);
    if (previousMeta) {
      if (previousMeta.lastModified !== pageData.meta.lastModified) {
        // Page changed since last cached metadata, trigger event
        this.emit("pageChanged", pageData.meta);
      }
    }
    this.pageMetaCache.set(name, pageData.meta);
    return pageData;
  }

  watchPage(pageName: string) {
    this.watchedPages.add(pageName);
  }

  unwatchPage(pageName: string) {
    this.watchedPages.delete(pageName);
  }

  async writePage(
    name: string,
    text: string,
    selfUpdate?: boolean,
    lastModified?: number
  ): Promise<PageMeta> {
    try {
      this.saving = true;
      let pageMeta = await this.space.writePage(
        name,
        text,
        selfUpdate,
        lastModified
      );
      if (!selfUpdate) {
        this.emit("pageChanged", pageMeta);
      }
      return this.metaCacher(name, pageMeta);
    } finally {
      this.saving = false;
    }
  }

  fetchPageList(): Promise<{ pages: Set<PageMeta>; nowTimestamp: number }> {
    return this.space.fetchPageList();
  }

  fetchAttachmentList(): Promise<{
    attachments: Set<AttachmentMeta>;
    nowTimestamp: number;
  }> {
    return this.space.fetchAttachmentList();
  }
  readAttachment(
    name: string
  ): Promise<{ buffer: ArrayBuffer; meta: AttachmentMeta }> {
    return this.space.readAttachment(name);
  }
  getAttachmentMeta(name: string): Promise<AttachmentMeta> {
    return this.space.getAttachmentMeta(name);
  }
  writeAttachment(
    name: string,
    blob: ArrayBuffer,
    selfUpdate?: boolean | undefined,
    lastModified?: number | undefined
  ): Promise<AttachmentMeta> {
    return this.space.writeAttachment(name, blob, selfUpdate, lastModified);
  }
  deleteAttachment(name: string): Promise<void> {
    return this.space.deleteAttachment(name);
  }

  private metaCacher(name: string, pageMeta: PageMeta): PageMeta {
    this.pageMetaCache.set(name, pageMeta);
    return pageMeta;
  }
}
