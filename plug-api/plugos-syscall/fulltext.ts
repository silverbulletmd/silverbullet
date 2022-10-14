import { syscall } from "./syscall.ts";

export function fullTextIndex(key: string, value: string) {
  return syscall("fulltext.index", key, value);
}

export function fullTextDelete(key: string) {
  return syscall("fulltext.delete", key);
}

export function fullTextSearch(phrase: string, limit = 100) {
  return syscall("fulltext.search", phrase, limit);
}
