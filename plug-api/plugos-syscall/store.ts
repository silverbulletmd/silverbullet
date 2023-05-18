import { syscall } from "./syscall.ts";

export type KV = {
  key: string;
  value: any;
};

export type Query = {
  filter?: Filter[];
  orderBy?: string;
  orderDesc?: boolean;
  limit?: number;
  select?: string[];
};

export type Filter = {
  op: string;
  prop: string;
  value: any;
};

export function set(key: string, value: any): Promise<void> {
  return syscall("store.set", key, value);
}

export function batchSet(kvs: KV[]): Promise<void> {
  return syscall("store.batchSet", kvs);
}

export function get(key: string): Promise<any> {
  return syscall("store.get", key);
}

export function batchGet(keys: string[]): Promise<(any | undefined)[]> {
  return syscall("store.batchGet", keys);
}

export function has(key: string): Promise<boolean> {
  return syscall("store.has", key);
}

export function del(key: string): Promise<void> {
  return syscall("store.delete", key);
}

export function batchDel(keys: string[]): Promise<void> {
  return syscall("store.batchDelete", keys);
}

export function queryPrefix(
  prefix: string,
): Promise<{ key: string; value: any }[]> {
  return syscall("store.queryPrefix", prefix);
}

export function deletePrefix(prefix: string): Promise<void> {
  return syscall("store.deletePrefix", prefix);
}

export function deleteAll(): Promise<void> {
  return syscall("store.deleteAll");
}
