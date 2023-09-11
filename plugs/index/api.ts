import { dataStore } from "$sb/syscalls.ts";
import { KV, KvKey } from "$sb/types.ts";

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

export function indexEntities(
  page: string,
  type: string,
  entities: KV[],
): Promise<void> {
  return batchSet(
    page,
    entities.map(({ key, value }) => ({
      key: [type, ...key],
      value,
    })),
  );
}

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
  return dataStore.batchDel(allKeys);
}
