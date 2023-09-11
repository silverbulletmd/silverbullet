import { applyQueryNoFilterKV, evalQueryExpression } from "$sb/lib/query.ts";
import { FunctionMap, KV, KvKey, KvQuery, KvValue } from "$sb/types.ts";
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

  async get(key: KvKey): Promise<KvValue> {
    return (await this.kv.batchGet([key]))[0];
  }

  batchGet(keys: KvKey[]): Promise<KvValue[]> {
    return this.kv.batchGet(keys);
  }

  set(key: KvKey, value: KvValue): Promise<void> {
    return this.kv.batchSet([{ key, value }]);
  }

  batchSet(entries: KV[]): Promise<void> {
    return this.kv.batchSet(entries);
  }

  delete(key: KvKey): Promise<void> {
    return this.kv.batchDelete([key]);
  }

  batchDelete(keys: KvKey[]): Promise<void> {
    return this.kv.batchDelete(keys);
  }

  async query(query: KvQuery): Promise<KV[]> {
    const results: KV[] = [];
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
}
