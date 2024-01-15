import { KV, KvQuery, ObjectQuery, ObjectValue } from "$sb/types.ts";
import { invokeFunction } from "$sb/silverbullet-syscall/system.ts";
import { ttlCache } from "$sb/lib/memory_cache.ts";

export function indexObjects<T>(
  page: string,
  objects: ObjectValue<T>[],
): Promise<void> {
  return invokeFunction("index.indexObjects", page, objects);
}

export function batchSet(page: string, kvs: KV[]): Promise<void> {
  return invokeFunction("index.batchSet", page, kvs);
}

export function query(
  query: KvQuery,
): Promise<KV[]> {
  return invokeFunction("index.query", query);
}

export function queryObjects<T>(
  tag: string,
  query: ObjectQuery,
  ttlSecs?: number,
): Promise<ObjectValue<T>[]> {
  return ttlCache(
    query,
    () => invokeFunction("index.queryObjects", tag, query),
    ttlSecs, // no-op when undefined
  );
}

export function getObjectByRef<T>(
  page: string,
  tag: string,
  ref: string,
): Promise<T | undefined> {
  return invokeFunction("index.getObjectByRef", page, tag, ref);
}
