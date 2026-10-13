import { syscall } from "../syscall.ts";
import type {
  QueryOptions,
  RelatedResult,
  SearchResult,
  SearchStatus,
} from "../types/search.ts";

export type {
  QueryOptions,
  RelatedResult,
  SearchMatch,
  SearchMode,
  SearchResult,
  SearchScope,
  SearchStatus,
} from "../types/search.ts";

export function rankObjects(
  objects: any[],
  phrase: string,
  options?: {
    fields?: Record<string, number | { weight: number; segments?: boolean }>;
  },
): Promise<any[]> {
  return syscall("search.rank", objects, phrase, options);
}

export function status(): Promise<SearchStatus> {
  return syscall("search.status");
}

export function find(q: string, options?: QueryOptions): Promise<SearchResult> {
  return syscall("search.find", q, options);
}

export function related(
  page: string,
  options?: { limit?: number },
): Promise<RelatedResult> {
  return syscall("search.related", page, options);
}
