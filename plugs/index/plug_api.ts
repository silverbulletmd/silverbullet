import { system } from "@silverbulletmd/silverbullet/syscalls";
import type { ObjectValue } from "../../type/index.ts";

import type { KV, KvQuery } from "../../type/datastore.ts";

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

export function getObjectByRef<T>(
  page: string,
  tag: string,
  ref: string,
): Promise<T | undefined> {
  return system.invokeFunction("index.getObjectByRef", page, tag, ref);
}
