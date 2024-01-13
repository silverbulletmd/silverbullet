import { KvQuery } from "$sb/types.ts";
import { LimitedMap } from "../../common/limited_map.ts";
import type { SysCallMapping } from "../../plugos/system.ts";
import type { Client } from "../client.ts";
import { proxySyscall, proxySyscalls } from "./util.ts";

export function dataStoreProxySyscalls(client: Client): SysCallMapping {
  const syscalls = proxySyscalls(client, [
    "datastore.delete",
    "datastore.set",
    "datastore.batchSet",
    "datastore.batchDelete",
    "datastore.batchGet",
    "datastore.get",
  ]);
  // Add a cache for datastore.query
  const queryCache = new LimitedMap<any>(5);
  syscalls["datastore.query"] = async (ctx, query: KvQuery) => {
    let cacheKey: string | undefined;
    const cacheSecs = query.cacheSecs;
    // Should we do caching?
    if (cacheSecs) {
      // Remove the cacheSecs from the query
      query = { ...query, cacheSecs: undefined };
      cacheKey = JSON.stringify(query);
      const cachedResult = queryCache.get(cacheKey);
      if (cachedResult) {
        // Let's use the cached result
        return cachedResult;
      }
    }

    const result = await proxySyscall(
      ctx,
      client.httpSpacePrimitives,
      "datastore.query",
      [
        query,
      ],
    );
    if (cacheKey) {
      // Store in the cache
      queryCache.set(cacheKey, result, cacheSecs! * 1000);
    }
    return result;
  };
  return syscalls;
}
