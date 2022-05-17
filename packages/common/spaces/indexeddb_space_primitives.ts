import { SpacePrimitives } from "./space_primitives";
import { PageMeta } from "../types";
import Dexie, { Table } from "dexie";
import { Plug } from "@plugos/plugos/plug";

type Page = {
  name: string;
  text: string;
  meta: PageMeta;
};

export class IndexedDBSpacePrimitives implements SpacePrimitives {
  private pageTable: Table<Page, string>;

  constructor(dbName: string, readonly timeSkew: number = 0) {
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

  async fetchPageList(): Promise<{
    pages: Set<PageMeta>;
    nowTimestamp: number;
  }> {
    let allPages = await this.pageTable.toArray();
    return {
      pages: new Set(allPages.map((p) => p.meta)),
      nowTimestamp: Date.now() + this.timeSkew,
    };
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
    const meta: PageMeta = {
      name,
      lastModified: lastModified ? lastModified : Date.now() + this.timeSkew,
      perm: "rw",
    };
    await this.pageTable.put({
      name,
      text,
      meta,
    });
    return meta;
  }
}
