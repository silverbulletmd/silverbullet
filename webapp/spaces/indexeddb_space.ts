import { PlugMeta, Space, SpaceEvents } from "./space";
import { EventEmitter } from "../../common/event";
import { PageMeta } from "../../common/types";
import Dexie, { Table } from "dexie";
import { Plug } from "../../plugos/plug";
import { Manifest } from "../../common/manifest";

type Page = {
  name: string;
  text: string;
  meta: PageMeta;
};

type PlugManifest = {
  name: string;
  manifest: Manifest;
};

export class IndexedDBSpace extends EventEmitter<SpaceEvents> implements Space {
  private pageTable: Table<Page, string>;
  private plugMetaTable: Table<PlugMeta, string>;
  private plugManifestTable: Table<PlugManifest, string>;

  constructor(dbName: string) {
    super();
    const db = new Dexie(dbName);
    db.version(1).stores({
      page: "name",
      plugMeta: "name",
      plugManifest: "name",
    });
    this.pageTable = db.table("page");
    this.plugMetaTable = db.table("plugMeta");
    this.plugManifestTable = db.table("plugManifest");
  }

  async deletePage(name: string): Promise<void> {
    this.emit("pageDeleted", name);
    return this.pageTable.delete(name);
  }

  async getPageMeta(name: string): Promise<PageMeta> {
    let entry = await this.pageTable.get(name);
    if (entry) {
      return entry.meta;
    } else {
      throw Error(`Page not found ${name}`);
    }
  }

  invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[]
  ): Promise<any> {
    return plug.invoke(name, args);
  }

  async listPages(): Promise<Set<PageMeta>> {
    let allPages = await this.pageTable.toArray();
    let set = new Set(allPages.map((p) => p.meta));
    this.emit("pageListUpdated", set);
    return set;
  }

  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any> {
    return plug.syscall(name, args);
  }

  async readPage(name: string): Promise<{ text: string; meta: PageMeta }> {
    let page = await this.pageTable.get(name);
    if (page) {
      return page!;
    } else {
      return {
        text: "",
        meta: {
          name,
          lastModified: 0,
        },
      };
    }
  }

  async writePage(
    name: string,
    text: string,
    selfUpdate?: boolean,
    withMeta?: PageMeta
  ): Promise<PageMeta> {
    let meta = withMeta
      ? withMeta
      : {
          name,
          lastModified: new Date().getTime(),
        };
    await this.pageTable.put({
      name,
      text,
      meta,
    });
    if (!selfUpdate) {
      this.emit("pageChanged", meta);
    }
    // TODO: add pageCreated
    return meta;
  }

  unwatchPage(pageName: string): void {}

  updatePageListAsync(): void {
    this.listPages();
  }

  watchPage(pageName: string): void {}

  async listPlugs(): Promise<PlugMeta[]> {
    return this.plugMetaTable.toArray();
  }

  async loadPlug(name: string): Promise<Manifest> {
    let plugManifest = await this.plugManifestTable.get(name);
    if (plugManifest) {
      return plugManifest.manifest;
    } else {
      throw Error(`Plug not found ${name}`);
    }
  }
}
