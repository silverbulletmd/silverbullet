import { randomUUID } from "../../plug-api/lib/crypto.ts";
import type {
  QueryOptions,
  RelatedOptions,
  SearchResult,
  SearchStatus,
} from "../../plug-api/types/search.ts";
import type { Client } from "../client.ts";
import { ServerError, serverJson } from "../spaces/server_api.ts";

export type ServerSearch = {
  status(): Promise<SearchStatus>;
  find(query: string, options?: QueryOptions): Promise<SearchResult>;
  related(page: string, options?: RelatedOptions): Promise<SearchResult>;
};

export type ServerSearchOptions = {
  /** Pages to leave out of results (R8): merged into `exclude`, and dropped
   * again from the response in case the page list changed meanwhile. */
  hiddenPages: () => Set<string>;
};

// One id per tab: the server cancels this tab's previous search when a new one starts.
const clientId = randomUUID();
const headers = { "X-Search-Client": clientId };

// Space Lua scripts wait on the load-time status check, so a slow link must not stall them for long.
const statusTimeoutMs = 3000;

// Several Std scripts each check the status while loading, one after another;
// sharing one answer for this long turns those into a single request.
const statusReuseMs = 1000;

const unavailableStatus = (reason: string): SearchStatus => ({
  backend: null,
  model: null,
  capabilities: { modes: [], related: false },
  ready: false,
  progress: null,
  reason,
});

const emptyResult = (): SearchResult => ({
  items: [],
  total: 0,
  partial: false,
  notice: null,
});

/** `result` without the matches in `hidden` pages, counted out of `total`. */
function withoutHidden(
  result: SearchResult,
  hidden: Set<string>,
): SearchResult {
  if (hidden.size === 0) return result;
  const dropped = new Set(
    result.items.filter((m) => hidden.has(m.page)).map((m) => m.page),
  );
  if (dropped.size === 0) return result;
  return {
    ...result,
    items: result.items.filter((m) => !dropped.has(m.page)),
    total: Math.max(0, result.total - dropped.size),
  };
}

export function createServerSearch(
  client: Client,
  { hiddenPages }: ServerSearchOptions,
): ServerSearch {
  const post = <T>(endpoint: string, body: unknown) =>
    serverJson<T>(client, `.search/${endpoint}`, { body, headers });

  /** `extra` plus the hidden pages, so the server's limit and total already
   * leave them out; `withoutHidden` drops them again after the response, in
   * case the page list changed meanwhile. */
  const excludeHidden = (extra?: string[]): string[] | undefined => {
    const hidden = hiddenPages();
    return hidden.size > 0
      ? [...new Set([...(extra ?? []), ...hidden])]
      : extra;
  };

  const fetchStatus = async (): Promise<SearchStatus> => {
    try {
      return await serverJson<SearchStatus>(client, ".search/status", {
        headers,
        timeoutMs: statusTimeoutMs,
      });
    } catch (e) {
      return unavailableStatus(e instanceof Error ? e.message : String(e));
    }
  };

  let statusRequest: Promise<SearchStatus> | undefined;

  return {
    status(): Promise<SearchStatus> {
      if (!client.httpSpacePrimitives) {
        return Promise.resolve(
          unavailableStatus("Search requires a connection to the server"),
        );
      }
      if (!statusRequest) {
        statusRequest = fetchStatus();
        void statusRequest.then(() =>
          setTimeout(() => {
            statusRequest = undefined;
          }, statusReuseMs),
        );
      }
      return statusRequest;
    },

    async find(
      query: string,
      options: QueryOptions = {},
    ): Promise<SearchResult> {
      // The server classifies Pages and Meta by each page's tags; scope and
      // the explicit lists combine. Hidden pages are left out (see
      // `excludeHidden`), except that an explicit `include` asks for those
      // pages, hidden or not. The minimum query length is server
      // configuration, so the client does not guess it.
      const filterHidden = options.include === undefined;
      const exclude = filterHidden
        ? excludeHidden(options.exclude)
        : options.exclude;
      return post<SearchResult>("query", {
        query,
        mode: options.mode,
        scope: options.scope,
        include: options.include,
        exclude,
        limit: options.limit,
      }).then(
        (result) =>
          filterHidden ? withoutHidden(result, hiddenPages()) : result,
        (e: unknown) => {
          if (e instanceof ServerError && e.code === "query-too-short") {
            return emptyResult();
          }
          throw e;
        },
      );
    },

    async related(
      page: string,
      { limit, scope }: RelatedOptions = {},
    ): Promise<SearchResult> {
      // Hidden pages are left out as in `find`.
      const result = await post<SearchResult>("related", {
        page,
        limit,
        scope,
        exclude: excludeHidden(),
      });
      return withoutHidden(result, hiddenPages());
    },
  };
}
