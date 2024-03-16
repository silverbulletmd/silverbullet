import { syscall } from "../syscall.ts";
import { KV, KvKey, KvQuery } from "../types.ts";

export function set(key: KvKey, value: any): Promise<void> {
  return syscall("datastore.set", key, value);
}

export function batchSet(kvs: KV[]): Promise<void> {
  return syscall("datastore.batchSet", kvs);
}

export function get(key: KvKey): Promise<any> {
  return syscall("datastore.get", key);
}

export function batchGet(keys: KvKey[]): Promise<(any | undefined)[]> {
  return syscall("datastore.batchGet", keys);
}

export function del(key: KvKey): Promise<void> {
  return syscall("datastore.delete", key);
}

export function batchDel(keys: KvKey[]): Promise<void> {
  return syscall("datastore.batchDelete", keys);
}

export function query(
  query: KvQuery,
  variables: Record<string, any> = {},
): Promise<KV[]> {
  return syscall("datastore.query", query, variables);
}

export function queryDelete(
  query: KvQuery,
  variables?: Record<string, any>,
): Promise<void> {
  return syscall("datastore.queryDelete", query, variables);
}

export function listFunctions(): Promise<string[]> {
  return syscall("datastore.listFunctions");
}
