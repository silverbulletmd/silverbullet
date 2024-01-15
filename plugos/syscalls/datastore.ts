import { KV, KvKey, KvQuery } from "$sb/types.ts";
import type { DataStore } from "../lib/datastore.ts";
import type { SysCallMapping } from "../system.ts";

/**
 * Exposes the datastore API to plugs, but scoping everything to a prefix based on the plug's name
 * @param ds the datastore to wrap
 * @param prefix prefix to scope all keys to to which the plug name will be appended
 */
export function dataStoreSyscalls(ds: DataStore): SysCallMapping {
  return {
    "datastore.delete": (_ctx, key: KvKey) => {
      return ds.delete(key);
    },

    "datastore.set": (_ctx, key: KvKey, value: any) => {
      return ds.set(key, value);
    },

    "datastore.batchSet": (_ctx, kvs: KV[]) => {
      return ds.batchSet(kvs);
    },

    "datastore.batchDelete": (_ctx, keys: KvKey[]) => {
      return ds.batchDelete(keys);
    },

    "datastore.batchGet": (
      _ctx,
      keys: KvKey[],
    ): Promise<(any | undefined)[]> => {
      return ds.batchGet(keys);
    },

    "datastore.get": (_ctx, key: KvKey): Promise<any | null> => {
      return ds.get(key);
    },

    "datastore.query": async (_ctx, query: KvQuery): Promise<KV[]> => {
      return (await ds.query(query));
    },

    "datastore.queryDelete": (_ctx, query: KvQuery): Promise<void> => {
      return ds.queryDelete(query);
    },
  };
}
