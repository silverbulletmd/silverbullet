import { applyQueryNoFilterKV, evalQueryExpression } from "$sb/lib/query.ts";
import { FunctionMap, KV, KvKey, KvQuery } from "$sb/types.ts";
import { builtinFunctions } from "$sb/lib/builtin_query_functions.ts";
import { KvPrimitives } from "./kv_primitives.ts";
import { LimitedMap } from "../../common/limited_map.ts";

/**
 * This is the data store class you'll actually want to use, wrapping the primitives
 * in a more user-friendly way
 */
export class DataStore {
  private cache = new LimitedMap<any>(20);

  constructor(
    readonly kv: KvPrimitives,
    private enableCache = false,
    private functionMap: FunctionMap = builtinFunctions,
  ) {
  }

  async get<T = any>(key: KvKey): Promise<T | null> {
    return (await this.batchGet([key]))[0];
  }

  batchGet<T = any>(keys: KvKey[]): Promise<(T | null)[]> {
    return this.kv.batchGet(keys);
  }

  set(key: KvKey, value: any): Promise<void> {
    return this.batchSet([{ key, value }]);
  }

  batchSet<T = any>(entries: KV<T>[]): Promise<void> {
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
    return this.kv.batchDelete(keys);
  }

  async query<T = any>(query: KvQuery): Promise<KV<T>[]> {
    let cacheKey: string | undefined;
    const cacheSecs = query.cacheSecs;
    // Should we do caching?
    if (cacheSecs && this.enableCache) {
      // Remove the cacheSecs from the query
      query = { ...query, cacheSecs: undefined };
      console.log("Going to cache query", query);
      cacheKey = JSON.stringify(query);
      const cachedResult = this.cache.get(cacheKey);
      if (cachedResult) {
        // Let's use the cached result
        return cachedResult;
      }
    }

    const results: KV<T>[] = [];
    let itemCount = 0;
    // Accumulate results
    let limit = Infinity;
    if (query.limit) {
      limit = evalQueryExpression(query.limit, {}, this.functionMap);
    }
    for await (
      const entry of this.kv.query(query)
    ) {
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
      if (itemCount === limit && !query.orderBy) {
        // Only break when not also ordering in which case we need all results
        break;
      }
    }
    // Apply order by, limit, and select
    const finalResult = applyQueryNoFilterKV(query, results, this.functionMap);
    if (cacheKey) {
      // Store in the cache
      this.cache.set(cacheKey, finalResult, cacheSecs! * 1000);
    }
    return finalResult;
  }

  async queryDelete(query: KvQuery): Promise<void> {
    const keys: KvKey[] = [];
    for (
      const { key } of await this.query(query)
    ) {
      keys.push(key);
    }
    return this.batchDelete(keys);
  }
}
