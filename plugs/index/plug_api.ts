import { KV, KvQuery, ObjectQuery, ObjectValue } from "../../plug-api/types.ts";
import { ttlCache } from "$lib/memory_cache.ts";
import { system } from "$sb/syscalls.ts";

export function indexObjects<T>(
  page: string,
  objects: ObjectValue<T>[],
): Promise<void> {
  return system.invokeFunction("index.indexObjects", page, objects);
}

export function batchSet(page: string, kvs: KV[]): Promise<void> {
  return system.invokeFunction("index.batchSet", page, kvs);
}

export function query(
  query: KvQuery,
): Promise<KV[]> {
  return system.invokeFunction("index.query", query);
}

export function queryObjects<T>(
  tag: string,
  query: ObjectQuery,
  ttlSecs?: number,
): Promise<ObjectValue<T>[]> {
  return ttlCache(
    query,
    () => system.invokeFunction("index.queryObjects", tag, query),
    ttlSecs, // no-op when undefined
  );
}

export function getObjectByRef<T>(
  page: string,
  tag: string,
  ref: string,
): Promise<T | undefined> {
  return system.invokeFunction("index.getObjectByRef", page, tag, ref);
}
