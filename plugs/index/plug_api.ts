import { KV, KvQuery, ObjectQuery, ObjectValue } from "$sb/types.ts";
import { invokeFunction } from "$sb/silverbullet-syscall/system.ts";

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
): Promise<ObjectValue<T>[]> {
  return invokeFunction("index.queryObjects", tag, query);
}

export function getObjectByRef<T>(
  page: string,
  tag: string,
  ref: string,
): Promise<T | undefined> {
  return invokeFunction("index.getObjectByRef", page, tag, ref);
}
