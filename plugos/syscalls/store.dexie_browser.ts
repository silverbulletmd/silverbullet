import { SysCallMapping } from "../system.ts";
import { DexieKVStore } from "../lib/kv_store.dexie.ts";
import { KV } from "../lib/kv_store.ts";

export function storeSyscalls(
  db: DexieKVStore,
): SysCallMapping {
  return {
    "store.delete": (_ctx, key: string) => {
      return db.del(key);
    },

    "store.deletePrefix": (_ctx, prefix: string) => {
      return db.deletePrefix(prefix);
    },

    "store.deleteAll": () => {
      return db.deleteAll();
    },

    "store.set": (_ctx, key: string, value: any) => {
      return db.set(key, value);
    },

    "store.batchSet": (_ctx, kvs: KV[]) => {
      return db.batchSet(kvs);
    },

    "store.batchDelete": (_ctx, keys: string[]) => {
      return db.batchDelete(keys);
    },

    "store.batchGet": (
      _ctx,
      keys: string[],
    ): Promise<(any | undefined)[]> => {
      return db.batchGet(keys);
    },

    "store.get": (_ctx, key: string): Promise<any | null> => {
      return db.get(key);
    },

    "store.has": (_ctx, key: string): Promise<boolean> => {
      return db.has(key);
    },

    "store.queryPrefix": (
      _ctx,
      keyPrefix: string,
    ): Promise<{ key: string; value: any }[]> => {
      return db.queryPrefix(keyPrefix);
    },
  };
}
