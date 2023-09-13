import { syscall } from "$sb/plugos-syscall/syscall.ts";
import { KV, KvKey, KvQuery, KvValue } from "$sb/types.ts";

export function set(key: KvKey, value: KvValue): Promise<void> {
  return syscall("dataStore.set", key, value);
}

export function batchSet(kvs: KV[]): Promise<void> {
  return syscall("dataStore.batchSet", kvs);
}

export function get(key: KvKey): Promise<KvValue> {
  return syscall("dataStore.get", key);
}

export function batchGet(keys: KvKey[]): Promise<(KvValue | undefined)[]> {
  return syscall("dataStore.batchGet", keys);
}

export function del(key: KvKey): Promise<void> {
  return syscall("dataStore.delete", key);
}

export function batchDel(keys: KvKey[]): Promise<void> {
  return syscall("dataStore.batchDelete", keys);
}

export function query(
  query: KvQuery,
): Promise<KV[]> {
  return syscall("dataStore.query", query);
}

export function queryDelete(
  query: KvQuery,
): Promise<void> {
  return syscall("dataStore.queryDelete", query);
}
