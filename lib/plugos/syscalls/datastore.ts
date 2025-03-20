import {
  type LuaCollectionQuery,
  queryLua,
} from "$common/space_lua/query_collection.ts";
import type { CommonSystem } from "$common/common_system.ts";
import type { KV, KvKey } from "../../../plug-api/types.ts";
import type { DataStore } from "../../data/datastore.ts";
import type { SysCallMapping } from "../system.ts";
import {
  jsToLuaValue,
  LuaEnv,
  LuaStackFrame,
  luaValueToJS,
} from "$common/space_lua/runtime.ts";
import type { KvQueryOptions } from "$lib/data/kv_primitives.ts";

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

    "datastore.query": async (_ctx, options: KvQueryOptions): Promise<KV[]> => {
      const results: KV[] = [];
      for await (const item of ds.query(options)) {
        results.push(item);
      }
      return results;
    },

    "datastore.queryLua": async (
      _ctx,
      prefix: string[],
      query: LuaCollectionQuery,
      scopeVariables: Record<string, any> = {},
    ): Promise<any[]> => {
      const sf = LuaStackFrame.createWithGlobalEnv(
        commonSystem.spaceLuaEnv.env,
      );
      const env = new LuaEnv(commonSystem.spaceLuaEnv.env);
      for (const [key, value] of Object.entries(scopeVariables)) {
        env.setLocal(key, jsToLuaValue(value));
      }
      return (await queryLua<any>(ds.kv, prefix, query, env, sf)).map((item) =>
        luaValueToJS(item, sf)
      );
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
  };
}
