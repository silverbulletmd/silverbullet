import Dexie from "dexie";
import {SysCallMapping} from "../system";

export type KV = {
  key: string;
  value: any;
};

export function storeSyscalls(
  dbName: string,
  tableName: string
): SysCallMapping {
  const db = new Dexie(dbName);
  db.version(1).stores({
    [tableName]: "key",
  });
  const items = db.table(tableName);

  return {
    "store.delete": async (ctx, key: string) => {
      await items.delete(key);
    },

    "store.deletePrefix": async (ctx, prefix: string) => {
      await items.where("key").startsWith(prefix).delete();
    },

    "store.deleteAll": async () => {
      await items.clear();
    },

    "store.set": async (ctx, key: string, value: any) => {
      await items.put({
        key,
        value,
      });
    },

    "store.batchSet": async (ctx, kvs: KV[]) => {
      await items.bulkPut(
        kvs.map(({ key, value }) => ({
          key,
          value,
        }))
      );
    },

    "store.get": async (ctx, key: string): Promise<any | null> => {
      let result = await items.get({
        key,
      });
      return result ? result.value : null;
    },

    "store.queryPrefix": async (
      ctx,
      keyPrefix: string
    ): Promise<{ key: string; value: any }[]> => {
      let results = await items.where("key").startsWith(keyPrefix).toArray();
      return results.map((result) => ({
        key: result.key,
        value: result.value,
      }));
    },
  };
}
