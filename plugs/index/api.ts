import { dataStore } from "$sb/syscalls.ts";
import { KV, KvKey, KvQuery, ObjectValue } from "$sb/types.ts";
import { QueryProviderEvent } from "$sb/app_event.ts";

/*
 * Key namespace:
 * ["index", type, ...key, page] -> value
 * ["page", page, ...key] -> true // for fast page clearing
 * ["type", type] -> true // for fast type listing
 */

export function batchSet(page: string, kvs: KV[]): Promise<void> {
  const finalBatch: KV[] = [];
  for (const { key, value } of kvs) {
    finalBatch.push({
      key: ["index", ...key, page],
      value,
    }, {
      key: ["page", page, ...key],
      value: true,
    });
  }
  return dataStore.batchSet(finalBatch);
}

/**
 * Clears all keys for a given page
 * @param page
 */
export async function clearPageIndex(page: string): Promise<void> {
  const allKeys: KvKey[] = [];
  for (
    const { key } of await dataStore.query({
      prefix: ["page", page],
    })
  ) {
    allKeys.push(key);
    allKeys.push(["index", ...key.slice(2), page]);
  }
  await dataStore.batchDel(allKeys);
}

/**
 * Clears the entire datastore for this "index" plug
 */
export async function clearIndex(): Promise<void> {
  const allKeys: KvKey[] = [];
  for (
    const { key } of await dataStore.query({ prefix: [] })
  ) {
    allKeys.push(key);
  }
  await dataStore.batchDel(allKeys);
  console.log("Deleted", allKeys.length, "keys from the index");
}

// ENTITIES API

/**
 * Indexes entities in the data store
 */
export async function indexObjects<T>(
  page: string,
  objects: ObjectValue<T>[],
): Promise<void> {
  const allTypes = new Set<string>();
  // console.log("Now indexing objects", objects);
  const kvs: KV[] = [];
  for (const { key, value, type } of objects) {
    allTypes.add(type);
    kvs.push({
      key: [type, ...key, page],
      value,
    });
  }
  await batchSet(
    page,
    [...allTypes].filter((type) => !type.startsWith("$")).map((type) => ({
      key: ["$type", type],
      value: true,
    })),
  );
  return batchSet(page, kvs);
}

export async function queryObjects<T>(
  type: string,
  query: KvQuery,
): Promise<ObjectValue<T>[]> {
  return (await dataStore.query({
    ...query,
    prefix: ["index", type, ...(query.prefix ? query.prefix : [])],
  })).map(
    ({ key, value }) => ({ key, value, type }),
  );
}

export async function objectSourceProvider({
  query,
}: QueryProviderEvent): Promise<any[]> {
  const results = await dataStore.query({
    ...query,
    prefix: ["index", query.querySource!],
  });
  return results.map((r) => r.value);
}

export async function discoverSources() {
  return (await dataStore.query({ prefix: ["index", "$type"] })).map((
    { key },
  ) => key[2]);
}
