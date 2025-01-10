import {
  DataStoreQueryCollection,
  type LuaCollectionQuery,
} from "$common/space_lua/query_collection.ts";
import type { CommonSystem } from "$common/common_system.ts";
import type { KV, KvKey, KvQuery } from "../../../plug-api/types.ts";
import type { DataStore } from "../../data/datastore.ts";
import type { SysCallMapping } from "../system.ts";
import { LuaStackFrame } from "$common/space_lua/runtime.ts";

/**
 * Exposes the datastore API to plugs, but scoping everything to a prefix based on the plug's name
 * @param ds the datastore to wrap
 * @param prefix prefix to scope all keys to to which the plug name will be appended
 */
export function dataStoreReadSyscalls(
  ds: DataStore,
  commonSystem: CommonSystem,
): SysCallMapping {
  return {
    "datastore.batchGet": (
      _ctx,
      keys: KvKey[],
    ): Promise<(any | undefined)[]> => {
      return ds.batchGet(keys);
    },

    "datastore.get": (_ctx, key: KvKey): Promise<any | null> => {
      return ds.get(key);
    },

    "datastore.query": (
      _ctx,
      query: KvQuery,
      variables?: Record<string, any>,
    ): Promise<KV[]> => {
      return ds.query(query, variables);
    },

    "datastore.queryLua": (
      _ctx,
      prefix: string[],
      query: LuaCollectionQuery,
    ): Promise<KV[]> => {
      const dsQueryCollection = new DataStoreQueryCollection(ds, prefix);
      return dsQueryCollection.query(
        query,
        commonSystem.spaceLuaEnv.env,
        LuaStackFrame.lostFrame,
      );
    },

    "datastore.listFunctions": (): string[] => {
      return Object.keys(ds.functionMap);
    },
  };
}

export function dataStoreWriteSyscalls(ds: DataStore): SysCallMapping {
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

    "datastore.queryDelete": (
      _ctx,
      query: KvQuery,
      variables?: Record<string, any>,
    ): Promise<void> => {
      return ds.queryDelete(query, variables);
    },
  };
}
