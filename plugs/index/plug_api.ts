import { KvQuery, ObjectValue, Query } from "$sb/types.ts";
import { invokeFunction } from "$sb/silverbullet-syscall/system.ts";

export function indexObjects(
  page: string,
  objects: ObjectValue[],
): Promise<void> {
  return invokeFunction("index.indexObjects", page, objects);
}

export function queryObjects<T = any>(
  type: string,
  query: KvQuery,
): Promise<ObjectValue<T>[]> {
  return invokeFunction("index.queryObjects", type, query);
}
