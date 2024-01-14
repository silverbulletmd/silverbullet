import { KV, KvKey, KvQuery } from "$sb/types.ts";
import type { DataStore } from "../lib/datastore.ts";
import type { SysCallMapping } from "../system.ts";

/**
 * Exposes the datastore API to plugs, but scoping everything to a prefix based on the plug's name
 * @param ds the datastore to wrap
 * @param prefix prefix to scope all keys to to which the plug name will be appended
 */
export function dataStoreSyscalls(
  ds: DataStore,
  prefix: KvKey = ["ds"],
): SysCallMapping {
  return {
    "datastore.delete": (key: KvKey) => {
      return ds.delete(key);
    },

    "datastore.set": (key: KvKey, value: any) => {
      return ds.set(key, value);
    },

    "datastore.batchSet": (kvs: KV[]) => {
      return ds.batchSet(kvs);
    },

    "datastore.batchDelete": (keys: KvKey[]) => {
      return ds.batchDelete(keys);
    },

    "datastore.batchGet": (
      keys: KvKey[],
    ): Promise<(any | undefined)[]> => {
      return ds.batchGet(keys);
    },

    "datastore.get": (key: KvKey): Promise<any | null> => {
      return ds.get(key);
    },

    "datastore.query": async (
      query: KvQuery,
    ): Promise<KV[]> => {
      return (await ds.query(query));
    },

    "datastore.queryDelete": (
      query: KvQuery,
    ): Promise<void> => {
      return ds.queryDelete(query);
    },
  };
}
