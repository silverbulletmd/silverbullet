import { system } from "@silverbulletmd/silverbullet/syscalls";
import type { ObjectValue } from "../../plug-api/types/index.ts";

import type { KV } from "../../plug-api/types/datastore.ts";

export function indexObjects<T>(
  page: string,
  objects: ObjectValue<T>[],
): Promise<void> {
  return system.invokeFunction("index.indexObjects", page, objects);
}

export function batchSet(page: string, kvs: KV[]): Promise<void> {
  return system.invokeFunction("index.batchSet", page, kvs);
}

export function getObjectByRef<T>(
  page: string,
  tag: string,
  ref: string,
): Promise<T | undefined> {
  return system.invokeFunction("index.getObjectByRef", page, tag, ref);
}
