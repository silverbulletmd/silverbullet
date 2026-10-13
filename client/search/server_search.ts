import { randomUUID } from "../../plug-api/lib/crypto.ts";
import type {
  QueryOptions,
  RelatedResult,
  RgResult,
  SearchResult,
  SearchStatus,
} from "../../plug-api/types/search.ts";
import type { Client } from "../client.ts";
import type { ObjectIndex } from "../data/object_index.ts";
import { ServerError, serverJson } from "../spaces/server_api.ts";
import { type PageInfo, selectionForScope } from "./segments.ts";

export type ServerSearch = {
  status(): Promise<SearchStatus>;
  find(query: string, options?: QueryOptions): Promise<SearchResult>;
  related(page: string, limit?: number): Promise<RelatedResult>;
  rg(args: string[], stdinBase64?: string): Promise<RgResult>;
};

// One id per tab: the server cancels this tab's previous search when a new one starts.
const clientId = randomUUID();
const headers = { "X-Search-Client": clientId };

// Space Lua scripts wait on the load-time status check, so a slow link must not stall them for long.
const statusTimeoutMs = 3000;

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

export function createServerSearch(
  client: Client,
  objectIndex: ObjectIndex,
): ServerSearch {
  const post = <T>(endpoint: string, body: unknown) =>
    serverJson<T>(client, `.search/${endpoint}`, { body, headers });

  async function scopedSelection(scope: QueryOptions["scope"]) {
    if (scope !== "pages" && scope !== "meta") return undefined;
    if (!(await objectIndex.isIndexAvailable())) {
      throw new Error(
        "Page classification is waiting for the index. Use All to search every page.",
      );
    }
    const pages = await objectIndex.queryLuaObjects<PageInfo>(
      client.clientSystem.spaceLuaEnv.env,
      "page",
      {},
    );
    return selectionForScope(scope, pages);
  }

  return {
    async status(): Promise<SearchStatus> {
      if (!client.httpSpacePrimitives) {
        return unavailableStatus("Search requires a connection to the server");
      }
      try {
        return await serverJson<SearchStatus>(client, ".search/status", {
          headers,
          timeoutMs: statusTimeoutMs,
        });
      } catch (e) {
        return unavailableStatus(e instanceof Error ? e.message : String(e));
      }
    },

    async find(
      query: string,
      options: QueryOptions = {},
    ): Promise<SearchResult> {
      let { include, exclude } = options;
      if (!include && !exclude) {
        ({ include, exclude } = (await scopedSelection(options.scope)) ?? {});
      }
      // The minimum query length is server configuration, so the client does not guess it.
      return post<SearchResult>("query", {
        query,
        mode: options.mode,
        include,
        exclude,
        limit: options.limit,
      }).catch((e: unknown) => {
        if (e instanceof ServerError && e.code === "query-too-short") {
          return emptyResult();
        }
        throw e;
      });
    },

    related(page: string, limit?: number): Promise<RelatedResult> {
      return post<RelatedResult>("related", { page, limit });
    },

    rg(args: string[], stdinBase64?: string): Promise<RgResult> {
      return post<RgResult>("rg", { args, stdinBase64 });
    },
  };
}
