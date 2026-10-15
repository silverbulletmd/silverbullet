import { syscall } from "../syscall.ts";
import type {
  QueryOptions,
  RelatedOptions,
  SearchResult,
  SearchStatus,
} from "../types/search.ts";

export type {
  QueryOptions,
  RelatedOptions,
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

/**
 * Searches the space's pages on the server. `options.scope` limits the search
 * to Pages or Meta (pages tagged `meta`, `meta/…` or `template`), classified
 * by the server, so it works before the client's index is ready;
 * `include`/`exclude` narrow it further. Without `include`, pages hidden by
 * a page decoration are left out once the client knows about them.
 */
export function find(q: string, options?: QueryOptions): Promise<SearchResult> {
  return syscall("search.find", q, options);
}

export function related(
  page: string,
  options?: RelatedOptions,
): Promise<SearchResult> {
  return syscall("search.related", page, options);
}
