import { syscall } from "../syscall.ts";
import type {
  QueryOptions,
  RelatedResult,
  RgResult,
  SearchResult,
  SearchStatus,
} from "../types/search.ts";

export type {
  QueryOptions,
  RelatedResult,
  RgResult,
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

export function rg(args: string[], stdinBase64?: string): Promise<RgResult> {
  return syscall("search.rg", args, stdinBase64);
}
