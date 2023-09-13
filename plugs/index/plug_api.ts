import { ObjectValue, Query } from "$sb/types.ts";
import { invokeFunction } from "$sb/silverbullet-syscall/system.ts";

export function indexObjects(
  page: string,
  objects: ObjectValue[],
): Promise<void> {
  return invokeFunction("index.indexObjects", page, objects);
}

export function queryObjects(
  type: string,
  query: Query,
): Promise<ObjectValue[]> {
  return invokeFunction("index.queryObjects", type, query);
}
