import type { SysCallMapping } from "../../plugos/system.ts";
import Dexie from "dexie";

type Item = {
  page: string;
  key: string;
  value: any;
};

export type KV = {
  key: string;
  value: any;
};

export function pageIndexSyscalls(
  dbName: string,
  indexedDB?: any,
): SysCallMapping {
  const db = new Dexie(dbName, {
    indexedDB,
  });
  db.version(1).stores({
    "index": "[page+key], page, key",
  });
  const items = db.table<Item, { key: string; page: string }>("index");
  const apiObj: SysCallMapping = {
    "index.set": (_ctx, page: string, key: string, value: any) => {
      return items.put({ page, key, value });
    },
    "index.batchSet": async (_ctx, page: string, kvs: KV[]) => {
      // await items.bulkPut(kvs);
      if (kvs.length === 0) {
        return;
      }
      const values = kvs.flatMap((kv) => ({
        page,
        key: kv.key,
        value: kv.value,
      }));
      await items.bulkPut(values);
    },
    "index.delete": (_ctx, page: string, key: string) => {
      return items.delete({ page, key });
    },
    "index.get": async (_ctx, page: string, key: string) => {
      return (await items.get({ page, key }))?.value;
    },
    "index.queryPrefix": (_ctx, prefix: string) => {
      return items.where("key").startsWith(prefix).toArray();
    },
    "index.clearPageIndexForPage": async (ctx, page: string) => {
      await apiObj["index.deletePrefixForPage"](ctx, page, "");
    },
    "index.deletePrefixForPage": (_ctx, page: string, prefix: string) => {
      return items.where({ page }).and((it) => it.key.startsWith(prefix))
        .delete();
    },
    "index.clearPageIndex": () => {
      return items.clear();
    },
  };
  return apiObj;
}
