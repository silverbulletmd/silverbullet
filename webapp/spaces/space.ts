import { SpacePrimitives } from "./space_primitives";
import { safeRun } from "../util";
import { PageMeta } from "../../common/types";
import { EventEmitter } from "../../common/event";
import { Plug } from "../../plugos/plug";
import { Manifest } from "../../common/manifest";

const pageWatchInterval = 2000;
const trashPrefix = "_trash/";
const plugPrefix = "_plug/";

export type SpaceEvents = {
  pageCreated: (meta: PageMeta) => void;
  pageChanged: (meta: PageMeta) => void;
  pageDeleted: (name: string) => void;
  pageListUpdated: (pages: Set<PageMeta>) => void;
  plugLoaded: (plugName: string, plug: Manifest) => void;
  plugUnloaded: (plugName: string) => void;
};

export class Space extends EventEmitter<SpaceEvents> {
  pageMetaCache = new Map<string, PageMeta>();
  watchedPages = new Set<string>();
  private initialPageListLoad = true;
  private saving = false;

  constructor(private space: SpacePrimitives, private trashEnabled = true) {
    super();
    this.on({
      pageCreated: async (pageMeta) => {
        if (pageMeta.name.startsWith(plugPrefix)) {
          let pageData = await this.readPage(pageMeta.name);
          this.emit(
            "plugLoaded",
            pageMeta.name.substring(plugPrefix.length),
            JSON.parse(pageData.text)
          );
          this.watchPage(pageMeta.name);
        }
      },
      pageChanged: async (pageMeta) => {
        if (pageMeta.name.startsWith(plugPrefix)) {
          let pageData = await this.readPage(pageMeta.name);
          this.emit(
            "plugLoaded",
            pageMeta.name.substring(plugPrefix.length),
            JSON.parse(pageData.text)
          );
          this.watchPage(pageMeta.name);
        }
      },
    });
  }

  public updatePageListAsync() {
    safeRun(async () => {
      let newPageList = await this.space.fetchPageList();
      let deletedPages = new Set<string>(this.pageMetaCache.keys());
      newPageList.pages.forEach((meta) => {
        const pageName = meta.name;
        const oldPageMeta = this.pageMetaCache.get(pageName);
        const newPageMeta = {
          name: pageName,
          lastModified: meta.lastModified,
        };
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
    });
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
          const newMeta = await this.space.getPageMeta(pageName);
          if (oldMeta.lastModified !== newMeta.lastModified) {
            this.emit("pageChanged", newMeta);
          }
        }
      });
    }, pageWatchInterval);
    this.updatePageListAsync();
  }

  async deletePage(name: string, deleteDate?: number): Promise<void> {
    await this.getPageMeta(name); // Check if page exists, if not throws Error
    if (this.trashEnabled) {
      let pageData = await this.readPage(name);
      // Move to trash
      await this.writePage(
        `${trashPrefix}${name}`,
        pageData.text,
        false,
        deleteDate
      );
    }
    await this.space.deletePage(name);

    this.pageMetaCache.delete(name);
    this.emit("pageDeleted", name);
    this.emit("pageListUpdated", new Set([...this.pageMetaCache.values()]));
  }

  async getPageMeta(name: string): Promise<PageMeta> {
    return this.metaCacher(name, await this.space.getPageMeta(name));
  }

  invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[]
  ): Promise<any> {
    return this.space.invokeFunction(plug, env, name, args);
  }

  listPages(): Set<PageMeta> {
    return new Set(
      [...this.pageMetaCache.values()].filter(
        (pageMeta) =>
          !pageMeta.name.startsWith(trashPrefix) &&
          !pageMeta.name.startsWith(plugPrefix)
      )
    );
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

  private metaCacher(name: string, pageMeta: PageMeta): PageMeta {
    this.pageMetaCache.set(name, pageMeta);
    return pageMeta;
  }
}
