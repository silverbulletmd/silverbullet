import { ObjectQuery, ObjectValue } from "$sb/types.ts";
import { invokeFunction } from "$sb/silverbullet-syscall/system.ts";

export function indexObjects<T>(
  page: string,
  objects: ObjectValue<T>[],
): Promise<void> {
  return invokeFunction("index.indexObjects", page, objects);
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
): Promise<ObjectValue<T>[]> {
  return invokeFunction("index.getObjectByRef", page, tag, ref);
}
