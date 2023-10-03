import { applyQueryNoFilterKV, evalQueryExpression } from "$sb/lib/query.ts";
import { FunctionMap, KV, KvKey, KvQuery } from "$sb/types.ts";
import { builtinFunctions } from "$sb/lib/builtin_query_functions.ts";
import { KvPrimitives } from "./kv_primitives.ts";

/**
 * This is the data store class you'll actually want to use, wrapping the primitives
 * in a more user-friendly way
 */
export class DataStore {
  constructor(
    private kv: KvPrimitives,
    private prefix: KvKey = [],
    private functionMap: FunctionMap = builtinFunctions,
  ) {
  }

  prefixed(prefix: KvKey): DataStore {
    return new DataStore(
      this.kv,
      [...this.prefix, ...prefix],
      this.functionMap,
    );
  }

  async get<T = any>(key: KvKey): Promise<T | null> {
    return (await this.batchGet([key]))[0];
  }

  batchGet<T = any>(keys: KvKey[]): Promise<(T | null)[]> {
    return this.kv.batchGet(keys.map((key) => this.applyPrefix(key)));
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
        uniqueEntries.push({ key: this.applyPrefix(key), value });
      }
    }
    return this.kv.batchSet(uniqueEntries);
  }

  delete(key: KvKey): Promise<void> {
    return this.batchDelete([key]);
  }

  batchDelete(keys: KvKey[]): Promise<void> {
    return this.kv.batchDelete(keys.map((key) => this.applyPrefix(key)));
  }

  async query<T = any>(query: KvQuery): Promise<KV<T>[]> {
    const results: KV<T>[] = [];
    let itemCount = 0;
    // Accumulate results
    let limit = Infinity;
    const prefixedQuery: KvQuery = {
      ...query,
      prefix: query.prefix ? this.applyPrefix(query.prefix) : undefined,
    };
    if (query.limit) {
      limit = evalQueryExpression(query.limit, {}, this.functionMap);
    }
    for await (
      const entry of this.kv.query(prefixedQuery)
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
    return applyQueryNoFilterKV(prefixedQuery, results, this.functionMap).map((
      { key, value },
    ) => ({ key: this.stripPrefix(key), value }));
  }

  async queryDelete(query: KvQuery): Promise<void> {
    const keys: KvKey[] = [];
    for (
      const { key } of await this.query({
        ...query,
        prefix: query.prefix ? this.applyPrefix(query.prefix) : undefined,
      })
    ) {
      keys.push(key);
    }
    return this.batchDelete(keys);
  }

  private applyPrefix(key: KvKey): KvKey {
    return [...this.prefix, ...(key ? key : [])];
  }

  private stripPrefix(key: KvKey): KvKey {
    return key.slice(this.prefix.length);
  }
}
