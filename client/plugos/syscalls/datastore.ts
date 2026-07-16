import {
  type LuaCollectionQuery,
  queryLua,
} from "../../space_lua/query_collection.ts";
import type { DataStore } from "../../data/datastore.ts";
import type { SysCallMapping } from "../system.ts";
import {
  jsToLuaValue,
  LuaEnv,
  LuaStackFrame,
  luaValueToJS,
} from "../../space_lua/runtime.ts";
import type { KvQueryOptions } from "../../data/kv_primitives.ts";
import type { ClientSystem } from "../../client_system.ts";

import type { KV, KvKey } from "@silverbulletmd/silverbullet/type/datastore";

/**
 * Exposes the datastore API to plugs, but scoping everything to a prefix based on the plug's name
 * @param ds the datastore to wrap
 * @param prefix prefix to scope all keys to to which the plug name will be appended
 */
export function dataStoreReadSyscalls(
  ds: DataStore,
  clientSystem: ClientSystem,
): SysCallMapping {
  return {
    "datastore.batchGet": {
      callback: (_ctx, keys: KvKey[]): Promise<(any | undefined)[]> => {
        return ds.batchGet(keys);
      },
      description: "Gets multiple values from the key-value store.",
      parameters: [
        { name: "keys", type: "table", description: "List of keys to read." },
      ],
      returns: [
        {
          type: "table",
          description: "Values in key order, with nil for missing keys.",
        },
      ],
      examples: [
        {
          code: 'local values = datastore.batchGet({{"user", "1"}, {"user", "2"}})',
        },
      ],
    },

    "datastore.get": {
      callback: (_ctx, key: KvKey): Promise<any | null> => {
        return ds.get(key);
      },
      description: "Gets a value from the key-value store.",
      parameters: [
        { name: "key", type: "table", description: "Key segments." },
      ],
      returns: [{ description: "Stored value, or nil when absent." }],
      examples: [{ code: 'local user = datastore.get({"user", "123"})' }],
    },

    "datastore.query": {
      callback: async (_ctx, options: KvQueryOptions): Promise<KV[]> => {
        const results: KV[] = [];
        for await (const item of ds.query(options)) {
          results.push(item);
        }
        return results;
      },
      description:
        "Queries key-value entries, optionally restricted to a key prefix.",
      parameters: [
        {
          name: "options",
          type: "table",
          description: "Query options, including an optional prefix.",
        },
      ],
      returns: [{ type: "table", description: "Matching key-value entries." }],
    },

    "datastore.queryLua": {
      callback: async (
        _ctx,
        prefix: string[],
        query: LuaCollectionQuery,
        scopeVariables?: Record<string, any>,
      ): Promise<any[]> => {
        const sf = LuaStackFrame.createWithGlobalEnv(
          clientSystem.spaceLuaEnv.env,
        );
        let env = clientSystem.spaceLuaEnv.env;
        if (scopeVariables) {
          env = new LuaEnv(clientSystem.spaceLuaEnv.env);
          for (const [key, value] of Object.entries(scopeVariables)) {
            env.setLocal(key, jsToLuaValue(value));
          }
        }
        return (await queryLua<any>(ds.kv, prefix, query, env, sf)).map(
          (item) => luaValueToJS(item, sf),
        );
      },
      description: "Runs a Space Lua collection query over a key prefix.",
      parameters: [
        {
          name: "prefix",
          type: "table",
          description: "Key prefix to query.",
        },
        {
          name: "query",
          type: "table",
          description: "Parsed collection query.",
        },
        {
          name: "scopeVariables",
          type: "table",
          description: "Additional variables available to the query.",
          optional: true,
        },
      ],
      returns: [
        {
          type: "table",
          description: "Query results converted to Lua values.",
        },
      ],
    },
  };
}

export function dataStoreWriteSyscalls(ds: DataStore): SysCallMapping {
  return {
    "datastore.delete": {
      callback: (_ctx, key: KvKey) => {
        console.log("Deleting key", key);
        return ds.delete(key);
      },
      description: "Deletes a value from the key-value store.",
      parameters: [
        { name: "key", type: "table", description: "Key segments." },
      ],
      examples: [{ code: 'datastore.delete({"user", "123"})' }],
    },

    "datastore.set": {
      callback: (_ctx, key: KvKey, value: any) => {
        return ds.set(key, value);
      },
      description: "Sets a value in the key-value store.",
      parameters: [
        { name: "key", type: "table", description: "Key segments." },
        { name: "value", description: "Value to store." },
      ],
      examples: [{ code: 'datastore.set({"user", "123"}, {name = "John"})' }],
    },

    "datastore.batchSet": {
      callback: (_ctx, kvs: KV[]) => {
        return ds.batchSet(kvs);
      },
      description: "Sets multiple key-value entries in one operation.",
      parameters: [
        {
          name: "entries",
          type: "table",
          description: "Entries with key and value fields.",
        },
      ],
      examples: [
        {
          code: 'datastore.batchSet({\n  {key = {"user", "1"}, value = {name = "Alice"}},\n  {key = {"user", "2"}, value = {name = "Bob"}},\n})',
        },
      ],
    },

    "datastore.batchDelete": {
      callback: (_ctx, keys: KvKey[]) => {
        return ds.batchDelete(keys);
      },
      description: "Deletes multiple values from the key-value store.",
      parameters: [
        {
          name: "keys",
          type: "table",
          description: "List of keys to delete.",
        },
      ],
      examples: [
        {
          code: 'datastore.batchDelete({{"user", "1"}, {"user", "2"}})',
        },
      ],
    },
  };
}
