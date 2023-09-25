import { ObjectQuery, ObjectValue } from "$sb/types.ts";
import { invokeFunction } from "$sb/silverbullet-syscall/system.ts";

export function indexObjects<T>(
  page: string,
  objects: ObjectValue<T>[],
): Promise<void> {
  return invokeFunction("index.indexObjects", page, objects);
}

export function queryObjects<T>(
  type: string,
  query: ObjectQuery,
): Promise<ObjectValue<T>[]> {
  return invokeFunction("index.queryObjects", type, query);
}
