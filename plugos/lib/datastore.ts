import { applyQueryNoFilterKV, evalQueryExpression } from "$sb/lib/query.ts";
import { FunctionMap, KV, KvKey, KvQuery } from "$sb/types.ts";
import { KvPrimitives } from "./kv_primitives.ts";

/**
 * This is the data store class you'll actually want to use, wrapping the primitives
 * in a more user-friendly way
 */
export class DataStore {
  constructor(
    private kv: KvPrimitives,
    private functionMap: FunctionMap = {},
  ) {
  }

  async get<T = any>(key: KvKey): Promise<T> {
    return (await this.kv.batchGet([key]))[0];
  }

  batchGet<T = any>(keys: KvKey[]): Promise<T[]> {
    return this.kv.batchGet(keys);
  }

  set(key: KvKey, value: any): Promise<void> {
    return this.kv.batchSet([{ key, value }]);
  }

  batchSet(entries: KV[]): Promise<void> {
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
    return this.kv.batchDelete([key]);
  }

  batchDelete(keys: KvKey[]): Promise<void> {
    return this.kv.batchDelete(keys);
  }

  async query<T = any>(query: KvQuery): Promise<KV<T>[]> {
    const results: KV<T>[] = [];
    let itemCount = 0;
    // Accumulate results
    for await (const entry of this.kv.query({ prefix: query.prefix })) {
      // Filter
      if (
        query.filter &&
        !evalQueryExpression(query.filter, entry.value, this.functionMap)
      ) {
        continue;
      }
      results.push(entry);
      itemCount++;
      // Stop when the limit has been reached
      if (itemCount === query.limit) {
        break;
      }
    }
    // Apply order by, limit, and select
    return applyQueryNoFilterKV(query, results, this.functionMap);
  }

  async queryDelete(query: KvQuery): Promise<void> {
    const keys: KvKey[] = [];
    for (const { key } of await this.query(query)) {
      keys.push(key);
    }
    return this.batchDelete(keys);
  }
}
