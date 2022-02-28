import { Dexie, Table } from "dexie";
import { AppEventDispatcher, IndexEvent } from "./app_event";
import { Space } from "./space";
import { PageMeta } from "./types";

function constructKey(pageName: string, key: string): string {
  return `${pageName}:${key}`;
}

function cleanKey(pageName: string, fromKey: string): string {
  return fromKey.substring(pageName.length + 1);
}

export type KV = {
  key: string;
  value: any;
};

export class Indexer {
  db: Dexie;
  pageIndex: Table;
  space: Space;

  constructor(name: string, space: Space) {
    this.db = new Dexie(name);
    this.space = space;
    this.db.version(1).stores({
      pageIndex: "ck, page, key",
    });
    this.pageIndex = this.db.table("pageIndex");
  }

  async clearPageIndexForPage(pageName: string) {
    await this.pageIndex.where({ page: pageName }).delete();
  }

  async clearPageIndex() {
    await this.pageIndex.clear();
  }

  async setPageIndexPageMeta(pageName: string, meta: PageMeta) {
    await this.set(pageName, "$meta", {
      lastModified: meta.lastModified.getTime(),
    });
  }

  async getPageIndexPageMeta(pageName: string): Promise<PageMeta | null> {
    let meta = await this.get(pageName, "$meta");
    if (meta) {
      return {
        name: pageName,
        lastModified: new Date(meta.lastModified),
      };
    } else {
      return null;
    }
  }

  async indexPage(
    appEventDispatcher: AppEventDispatcher,
    pageMeta: PageMeta,
    text: string,
    withFlush: boolean
  ) {
    if (withFlush) {
      await this.clearPageIndexForPage(pageMeta.name);
    }
    let indexEvent: IndexEvent = {
      name: pageMeta.name,
      text,
    };
    await appEventDispatcher.dispatchAppEvent("page:index", indexEvent);
    await this.setPageIndexPageMeta(pageMeta.name, pageMeta);
  }

  async reindexSpace(space: Space, appEventDispatcher: AppEventDispatcher) {
    await this.clearPageIndex();
    let allPages = await space.listPages();
    // TODO: Parallelize?
    for (let page of allPages) {
      let pageData = await space.readPage(page.name);
      await this.indexPage(
        appEventDispatcher,
        pageData.meta,
        pageData.text,
        false
      );
    }
  }

  async set(pageName: string, key: string, value: any) {
    await this.pageIndex.put({
      ck: constructKey(pageName, key),
      page: pageName,
      key: key,
      value: value,
    });
  }

  async batchSet(pageName: string, kvs: KV[]) {
    await this.pageIndex.bulkPut(
      kvs.map(({ key, value }) => ({
        ck: constructKey(pageName, key),
        key: key,
        page: pageName,
        value: value,
      }))
    );
  }

  async get(pageName: string, key: string): Promise<any | null> {
    let result = await this.pageIndex.get({
      ck: constructKey(pageName, key),
    });
    return result ? result.value : null;
  }

  async scanPrefixForPage(
    pageName: string,
    keyPrefix: string
  ): Promise<{ key: string; value: any }[]> {
    let results = await this.pageIndex
      .where("ck")
      .startsWith(constructKey(pageName, keyPrefix))
      .toArray();
    return results.map((result) => ({
      key: cleanKey(pageName, result.key),
      value: result.value,
    }));
  }

  async scanPrefixGlobal(
    keyPrefix: string
  ): Promise<{ key: string; value: any }[]> {
    let results = await this.pageIndex
      .where("key")
      .startsWith(keyPrefix)
      .toArray();
    return results.map((result) => ({
      key: result.key,
      value: result.value,
    }));
  }

  async deletePrefixForPage(pageName: string, keyPrefix: string) {
    await this.pageIndex
      .where("ck")
      .startsWith(constructKey(pageName, keyPrefix))
      .delete();
  }

  async delete(pageName: string, key: string) {
    await this.pageIndex.delete(constructKey(pageName, key));
  }
}
