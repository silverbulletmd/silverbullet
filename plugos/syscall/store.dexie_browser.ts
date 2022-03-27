import Dexie from "dexie";
import { SysCallMapping } from "../system";

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
    test: "key",
  });
  const items = db.table(tableName);

  return {
    async delete(ctx, key: string) {
      await items.delete(key);
    },

    async deletePrefix(ctx, prefix: string) {
      await items.where("key").startsWith(prefix).delete();
    },

    async deleteAll() {
      await items.clear();
    },

    async set(ctx, key: string, value: any) {
      await items.put({
        key,
        value,
      });
    },

    async batchSet(ctx, kvs: KV[]) {
      await items.bulkPut(
        kvs.map(({ key, value }) => ({
          key,
          value,
        }))
      );
    },

    async get(ctx, key: string): Promise<any | null> {
      let result = await items.get({
        key,
      });
      return result ? result.value : null;
    },

    async queryPrefix(
      ctx,
      keyPrefix: string
    ): Promise<{ key: string; value: any }[]> {
      let results = await items.where("key").startsWith(keyPrefix).toArray();
      return results.map((result) => ({
        key: result.key,
        value: result.value,
      }));
    },
  };
}
