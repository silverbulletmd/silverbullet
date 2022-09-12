import { syscall } from "./syscall";

export async function fullTextIndex(key: string, value: string) {
  return syscall("fulltext.index", key, value);
}

export async function fullTextDelete(key: string) {
  return syscall("fulltext.delete", key);
}

export async function fullTextSearch(phrase: string, limit: number = 100) {
  return syscall("fulltext.search", phrase, limit);
}
