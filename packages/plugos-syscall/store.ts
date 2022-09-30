import { syscall } from "./syscall";

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

export async function set(key: string, value: any): Promise<void> {
  return syscall("store.set", key, value);
}

export async function batchSet(kvs: KV[]): Promise<void> {
  return syscall("store.batchSet", kvs);
}

export async function get(key: string): Promise<any> {
  return syscall("store.get", key);
}

export async function del(key: string): Promise<void> {
  return syscall("store.delete", key);
}

export async function batchDel(keys: string[]): Promise<void> {
  return syscall("store.batchDelete", keys);
}

export async function queryPrefix(
  prefix: string
): Promise<{ key: string; value: any }[]> {
  return syscall("store.queryPrefix", prefix);
}

export async function deletePrefix(prefix: string): Promise<void> {
  return syscall("store.deletePrefix", prefix);
}

export async function deleteAll(): Promise<void> {
  return syscall("store.deleteAll");
}
