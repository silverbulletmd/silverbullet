import { Space } from "./space";
import { PageMeta } from "../../common/types";
import Dexie, { Table } from "dexie";
import { Plug } from "../../plugos/plug";

type Page = {
  name: string;
  text: string;
  meta: PageMeta;
};

export class IndexedDBSpace implements Space {
  private pageTable: Table<Page, string>;

  constructor(dbName: string) {
    const db = new Dexie(dbName);
    db.version(1).stores({
      page: "name",
    });
    this.pageTable = db.table("page");
  }

  async deletePage(name: string): Promise<void> {
    return this.pageTable.delete(name);
  }

  async getPageMeta(name: string): Promise<PageMeta> {
    let entry = await this.pageTable.get(name);
    if (entry) {
      return entry.meta;
    } else {
      throw Error(`Page not found`);
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

  async fetchPageList(): Promise<Set<PageMeta>> {
    let allPages = await this.pageTable.toArray();
    let set = new Set(allPages.map((p) => p.meta));
    return set;
  }

  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any> {
    return plug.syscall(name, args);
  }

  async readPage(name: string): Promise<{ text: string; meta: PageMeta }> {
    let page = await this.pageTable.get(name);
    if (page) {
      return page;
    } else {
      throw new Error("Page not found");
    }
  }

  async writePage(
    name: string,
    text: string,
    selfUpdate?: boolean,
    lastModified?: number
  ): Promise<PageMeta> {
    let meta = {
      name,
      lastModified: lastModified ? lastModified : new Date().getTime(),
    };
    await this.pageTable.put({
      name,
      text,
      meta,
    });
    return meta;
  }
}
