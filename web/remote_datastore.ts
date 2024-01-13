import { HttpSpacePrimitives } from "../common/spaces/http_space_primitives.ts";
import { KV, KvKey, KvQuery } from "$sb/types.ts";
import { DataStore } from "../plugos/lib/datastore.ts";
import { rpcCall } from "./syscalls/datastore.proxy.ts";
import { LimitedMap } from "../common/limited_map.ts";
import { batchRequests } from "$sb/lib/async.ts";

const batchSize = 1000;

export class RemoteDataStore implements DataStore {
  private cache = new LimitedMap<any>(20);

  constructor(
    private httpPrimitives: HttpSpacePrimitives,
  ) {
  }

  private proxy(
    name: string,
    ...args: any[]
  ) {
    // console.trace();
    return rpcCall(
      this.httpPrimitives,
      name,
      ...args,
    );
  }

  async get<T = any>(key: KvKey): Promise<T | null> {
    const results = await this.batchGet([key]);
    return results[0];
  }

  // TODO: Batch these up
  batchGet<T = any>(keys: KvKey[]): Promise<(T | null)[]> {
    return this.proxy("datastore.batchGet", keys);
  }

  set(key: KvKey, value: any): Promise<void> {
    return this.batchSet([{ key, value }]);
  }

  // TODO: Batch these up
  async batchSet<T = any>(entries: KV<T>[]): Promise<void> {
    await batchRequests(
      entries,
      (entries) => this.proxy("datastore.batchSet", entries),
      batchSize,
    );
  }

  delete(key: KvKey): Promise<void> {
    return this.batchDelete([key]);
  }

  // TODO: batch these up
  async batchDelete(keys: KvKey[]): Promise<void> {
    await batchRequests(
      keys,
      (keys) => this.proxy("datastore.batchDelete", keys),
      batchSize,
    );
  }

  /**
   * Proxies the query to the server, and caches the result if cacheSecs is set
   * @param query query to execute
   * @returns
   */
  async query<T = any>(query: KvQuery): Promise<KV<T>[]> {
    let cacheKey: string | undefined;
    const cacheSecs = query.cacheSecs;
    // Should we do caching?
    if (cacheSecs) {
      // Remove the cacheSecs from the query
      query = { ...query, cacheSecs: undefined };
      cacheKey = JSON.stringify(query);
      const cachedResult = this.cache.get(cacheKey);
      if (cachedResult) {
        // Let's use the cached result
        return cachedResult;
      }
    }
    const result = await this.proxy("datastore.query", query);
    if (cacheKey) {
      // Store in the cache
      this.cache.set(cacheKey, result, cacheSecs! * 1000);
    }
    return result;
  }

  queryDelete(query: KvQuery): Promise<void> {
    return this.proxy("datastore.queryDelete", query);
  }
}
