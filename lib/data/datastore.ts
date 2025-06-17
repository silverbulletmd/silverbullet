import {
  type LuaCollectionQuery,
  queryLua,
} from "../space_lua/query_collection.ts";
import { LuaEnv, LuaStackFrame } from "../space_lua/runtime.ts";
import type { KvPrimitives, KvQueryOptions } from "./kv_primitives.ts";

import type { KV, KvKey } from "../../type/datastore.ts";

/**
 * This is the data store class you'll actually want to use, wrapping the primitives
 * in a more user-friendly way
 */
export class DataStore {
  constructor(
    readonly kv: KvPrimitives,
  ) {
  }

  async get<T = any>(key: KvKey): Promise<T | null> {
    return (await this.batchGet([key]))[0];
  }

  batchGet<T = any>(keys: KvKey[]): Promise<(T | null)[]> {
    if (keys.length === 0) {
      return Promise.resolve([]);
    }
    return this.kv.batchGet(keys);
  }

  set(key: KvKey, value: any): Promise<void> {
    return this.batchSet([{ key, value }]);
  }

  batchSet<T = any>(entries: KV<T>[]): Promise<void> {
    if (entries.length === 0) {
      return Promise.resolve();
    }
    const allKeyStrings = new Set<string>();
    const uniqueEntries: KV[] = [];
    for (const { key, value } of entries) {
      const keyString = JSON.stringify(key);
      if (allKeyStrings.has(keyString)) {
        console.warn(`Duplicate key ${keyString} in batchSet, skipping`);
      } else {
        allKeyStrings.add(keyString);
        uniqueEntries.push({ key, value });
      }
    }
    return this.kv.batchSet(uniqueEntries);
  }

  delete(key: KvKey): Promise<void> {
    return this.batchDelete([key]);
  }

  batchDelete(keys: KvKey[]): Promise<void> {
    if (keys.length === 0) {
      return Promise.resolve();
    }
    return this.kv.batchDelete(keys);
  }

  async batchDeletePrefix(prefix: KvKey): Promise<void> {
    const keys: KvKey[] = [];
    for await (const { key } of this.kv.query({ prefix })) {
      keys.push(key);
    }
    return this.batchDelete(keys);
  }

  query(options: KvQueryOptions): AsyncIterableIterator<KV> {
    return this.kv.query(options);
  }

  luaQuery<T = any>(
    prefix: KvKey,
    query: LuaCollectionQuery,
    env: LuaEnv = new LuaEnv(),
    sf: LuaStackFrame = LuaStackFrame.lostFrame,
    enricher?: (key: KvKey, item: any) => any,
  ): Promise<T[]> {
    return queryLua(this.kv, prefix, query, env, sf, enricher);
  }
}
