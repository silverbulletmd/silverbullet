import { PageMeta } from "./types";
import { EventEmitter } from "../common/event";
import { Manifest } from "../common/manifest";
import { safeRun } from "./util";
import { Plug } from "../plugos/plug";

export type SpaceEvents = {
  pageCreated: (meta: PageMeta) => void;
  pageChanged: (meta: PageMeta) => void;
  pageDeleted: (name: string) => void;
  pageListUpdated: (pages: Set<PageMeta>) => void;
  plugLoaded: (plugName: string, plug: Manifest) => void;
  plugUnloaded: (plugName: string) => void;
};

type PlugMeta = {
  name: string;
  version: number;
};

const pageWatchInterval = 2000;
const plugWatchInterval = 5000;

export class Space extends EventEmitter<SpaceEvents> {
  pageUrl: string;
  pageMetaCache = new Map<string, PageMeta>();
  plugMetaCache = new Map<string, PlugMeta>();
  watchedPages = new Set<string>();
  saving = false;
  private plugUrl: string;
  private initialPageListLoad = true;
  private initialPlugListLoad = true;

  constructor(url: string) {
    super();
    this.pageUrl = url + "/fs";
    this.plugUrl = url + "/plug";
    this.watch();
    this.pollPlugs();
    this.updatePageListAsync();
  }

  public watchPage(pageName: string) {
    this.watchedPages.add(pageName);
  }

  public unwatchPage(pageName: string) {
    this.watchedPages.delete(pageName);
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
          const newMeta = await this.getPageMeta(pageName);
          if (oldMeta.lastModified !== newMeta.lastModified) {
            console.log("Page", pageName, "changed on disk, emitting event");
            this.emit("pageChanged", newMeta);
          }
        }
      });
    }, pageWatchInterval);

    setInterval(() => {
      safeRun(this.pollPlugs.bind(this));
    }, plugWatchInterval);
  }

  public updatePageListAsync() {
    safeRun(async () => {
      let req = await fetch(this.pageUrl, {
        method: "GET",
      });

      let deletedPages = new Set<string>(this.pageMetaCache.keys());
      ((await req.json()) as any[]).forEach((meta: any) => {
        const pageName = meta.name;
        const oldPageMeta = this.pageMetaCache.get(pageName);
        const newPageMeta = {
          name: pageName,
          lastModified: meta.lastModified,
        };
        if (!oldPageMeta && !this.initialPageListLoad) {
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

      this.emit("pageListUpdated", new Set([...this.pageMetaCache.values()]));
      this.initialPageListLoad = false;
    });
  }

  public async listPages(): Promise<Set<PageMeta>> {
    // this.updatePageListAsync();
    return new Set([...this.pageMetaCache.values()]);
  }

  private responseToMetaCacher(name: string, res: Response): PageMeta {
    const meta = {
      name,
      lastModified: +(res.headers.get("Last-Modified") || "0"),
    };
    this.pageMetaCache.set(name, meta);
    return meta;
  }

  public async readPage(
    name: string
  ): Promise<{ text: string; meta: PageMeta }> {
    let res = await fetch(`${this.pageUrl}/${name}`, {
      method: "GET",
    });
    return {
      text: await res.text(),
      meta: this.responseToMetaCacher(name, res),
    };
  }

  public async writePage(
    name: string,
    text: string,
    selfUpdate?: boolean
  ): Promise<PageMeta> {
    try {
      this.saving = true;
      let res = await fetch(`${this.pageUrl}/${name}`, {
        method: "PUT",
        body: text,
      });
      const newMeta = this.responseToMetaCacher(name, res);
      if (!selfUpdate) {
        this.emit("pageChanged", newMeta);
      }
      return newMeta;
    } finally {
      this.saving = false;
    }
  }

  public async deletePage(name: string): Promise<void> {
    let req = await fetch(`${this.pageUrl}/${name}`, {
      method: "DELETE",
    });
    if (req.status !== 200) {
      throw Error(`Failed to delete page: ${req.statusText}`);
    }
    this.pageMetaCache.delete(name);
    this.emit("pageDeleted", name);
    this.emit("pageListUpdated", new Set([...this.pageMetaCache.values()]));
  }

  private async getPageMeta(name: string): Promise<PageMeta> {
    let res = await fetch(`${this.pageUrl}/${name}`, {
      method: "OPTIONS",
    });
    return this.responseToMetaCacher(name, res);
  }

  async remoteSyscall(
    plug: Plug<any>,
    name: string,
    args: any[]
  ): Promise<any> {
    let req = await fetch(`${this.plugUrl}/${plug.name}/syscall/${name}`, {
      method: "POST",
      headers: {
        "Content-type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (req.status !== 200) {
      let error = await req.text();
      throw Error(error);
    }
    if (req.headers.get("Content-length") === "0") {
      return;
    }
    return await req.json();
  }

  async remoteInvoke(plug: Plug<any>, name: string, args: any[]): Promise<any> {
    let req = await fetch(`${this.plugUrl}/${plug.name}/function/${name}`, {
      method: "POST",
      headers: {
        "Content-type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (req.status !== 200) {
      let error = await req.text();
      throw Error(error);
    }
    if (req.headers.get("Content-length") === "0") {
      return;
    }
    return await req.json();
  }

  private async pollPlugs(): Promise<void> {
    const newPlugs = await this.loadPlugs();
    let deletedPlugs = new Set<string>(this.plugMetaCache.keys());
    for (const newPlugMeta of newPlugs) {
      const oldPlugMeta = this.plugMetaCache.get(newPlugMeta.name);
      if (
        !oldPlugMeta ||
        (oldPlugMeta && oldPlugMeta.version !== newPlugMeta.version)
      ) {
        this.emit(
          "plugLoaded",
          newPlugMeta.name,
          await this.loadPlug(newPlugMeta.name)
        );
      }
      // Page found, not deleted
      deletedPlugs.delete(newPlugMeta.name);

      // Update in cache
      this.plugMetaCache.set(newPlugMeta.name, newPlugMeta);
    }

    for (const deletedPlug of deletedPlugs) {
      this.plugMetaCache.delete(deletedPlug);
      this.emit("plugUnloaded", deletedPlug);
    }
  }

  private async loadPlugs(): Promise<PlugMeta[]> {
    let res = await fetch(`${this.plugUrl}`, {
      method: "GET",
    });
    return (await res.json()) as PlugMeta[];
  }

  private async loadPlug(name: string): Promise<Manifest> {
    let res = await fetch(`${this.plugUrl}/${name}`, {
      method: "GET",
    });
    return (await res.json()) as Manifest;
  }
}
