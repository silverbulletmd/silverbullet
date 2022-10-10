import Dexie from "https://esm.sh/dexie@3.2.2";
import { SysCallMapping } from "../system.ts";

export type KV = {
  key: string;
  value: any;
};

export function storeSyscalls(
  dbName: string,
  tableName: string,
): SysCallMapping {
  const db = new Dexie(dbName);
  db.version(1).stores({
    [tableName]: "key",
  });
  const items = db.table(tableName);

  return {
    "store.delete": async (_ctx, key: string) => {
      await items.delete(key);
    },

    "store.deletePrefix": async (_ctx, prefix: string) => {
      await items.where("key").startsWith(prefix).delete();
    },

    "store.deleteAll": async () => {
      await items.clear();
    },

    "store.set": async (_ctx, key: string, value: any) => {
      await items.put({
        key,
        value,
      });
    },

    "store.batchSet": async (_ctx, kvs: KV[]) => {
      await items.bulkPut(
        kvs.map(({ key, value }) => ({
          key,
          value,
        })),
      );
    },

    "store.get": async (_ctx, key: string): Promise<any | null> => {
      const result = await items.get({
        key,
      });
      return result ? result.value : null;
    },

    "store.queryPrefix": async (
      _ctx,
      keyPrefix: string,
    ): Promise<{ key: string; value: any }[]> => {
      const results = await items.where("key").startsWith(keyPrefix).toArray();
      return results.map((result) => ({
        key: result.key,
        value: result.value,
      }));
    },
  };
}
