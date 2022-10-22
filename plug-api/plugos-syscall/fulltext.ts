import { syscall } from "./syscall.ts";

export function fullTextIndex(key: string, value: string) {
  return syscall("fulltext.index", key, value);
}

export function fullTextDelete(key: string) {
  return syscall("fulltext.delete", key);
}

export type FullTextSearchOptions = {
  limit?: number;
  highlightPrefix?: string;
  highlightPostfix?: string;
  highlightEllipsis?: string;
  summaryMaxLength?: number;
};

export function fullTextSearch(
  phrase: string,
  options: FullTextSearchOptions = {},
) {
  return syscall("fulltext.search", phrase, options);
}
