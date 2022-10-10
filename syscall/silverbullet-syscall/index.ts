import type { Query } from "../plugos-syscall/store.ts";
import { syscall } from "./syscall.ts";

export type KV = {
  key: string;
  value: any;
};

export function set(
  page: string,
  key: string,
  value: any,
): Promise<void> {
  return syscall("index.set", page, key, value);
}

export function batchSet(page: string, kvs: KV[]): Promise<void> {
  return syscall("index.batchSet", page, kvs);
}

export function get(page: string, key: string): Promise<any> {
  return syscall("index.get", page, key);
}

export function del(page: string, key: string): Promise<void> {
  return syscall("index.delete", page, key);
}

export function queryPrefix(
  prefix: string,
): Promise<{ key: string; page: string; value: any }[]> {
  return syscall("index.queryPrefix", prefix);
}

export function query(
  query: Query,
): Promise<{ key: string; page: string; value: any }[]> {
  return syscall("index.query", query);
}

export function clearPageIndexForPage(page: string): Promise<void> {
  return syscall("index.clearPageIndexForPage", page);
}

export function deletePrefixForPage(
  page: string,
  prefix: string,
): Promise<void> {
  return syscall("index.deletePrefixForPage", page, prefix);
}

export function clearPageIndex(): Promise<void> {
  return syscall("index.clearPageIndex");
}
