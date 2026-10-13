import { rank, type RankOptions } from "../../../plug-api/lib/fuzzy.ts";
import type { QueryOptions } from "../../../plug-api/types/search.ts";
import type { ServerSearch } from "../../search/server_search.ts";
import type { SysCallMapping } from "../system.ts";

export function searchSyscalls(search: ServerSearch): SysCallMapping {
  return {
    "search.rank": {
      callback: (
        _ctx,
        objects: Record<string, any>[],
        phrase: string,
        options?: {
          fields?: Record<
            string,
            number | { weight: number; segments?: boolean }
          >;
        },
      ) => rank(objects, phrase, options as RankOptions<any>),
      description:
        "Fuzzy-ranks objects against a phrase, best match first. The same ranker view panels use for filtering.",
      parameters: [
        { name: "objects", type: "table", description: "Objects to rank." },
        {
          name: "phrase",
          type: "string",
          description:
            "Phrase to match against. An empty phrase returns every object, in the order given.",
        },
        {
          name: "options",
          type: "table",
          description:
            "Ranking options. `fields` maps a field name to its weight, or to `{ weight, segments = true }` to also score the parts of a `/`-separated value.",
          optional: true,
        },
      ],
      returns: [
        {
          type: "table",
          description: "The matching objects, best match first.",
        },
      ],
    },
    "search.status": {
      callback: () => search.status(),
      description:
        "Reports the space's search backend: its name, the query modes it supports (the first is the default), whether it can find related pages, and whether it is ready.",
      returns: [
        {
          type: "table",
          description:
            "`{backend, model, capabilities = {modes, related}, ready, progress, reason}`. `backend` is nil when search is unavailable; `reason` says why.",
        },
      ],
    },
    "search.find": {
      callback: (_ctx, query: string, options?: QueryOptions) =>
        search.find(query, options),
      description:
        "Searches the space with its active search backend. A newer search from the same tab cancels an older one that is still running. Queries shorter than the server's minimum return no results.",
      parameters: [
        { name: "query", type: "string", description: "What to search for." },
        {
          name: "options",
          type: "table",
          description:
            "`mode` (one of `search.status().capabilities.modes`; defaults to the first), `scope` (`pages`, `meta` or `all`, like the page picker's segments; defaults to `all`), `include`/`exclude` (exact page names; when given they override `scope`), `limit` (maximum pages).",
          optional: true,
        },
      ],
      returns: [
        {
          type: "table",
          description:
            "`{items, total, partial, notice}`. Each item is `{page, pos, line, heading, excerpt, highlights}`; `heading` is set when the backend knows it, `pos` is the match's position in the page, `highlights` is a list of `[start, end]` pairs (UTF-16 offsets into `excerpt`, end exclusive).",
        },
      ],
      examples: [
        {
          code: 'local result = search.find("garden plan", {scope = "pages"})\nfor _, m in ipairs(result.items) do print(m.page, m.excerpt) end',
        },
      ],
    },
    "search.related": {
      callback: (_ctx, page: string, options: { limit?: number } = {}) =>
        search.related(page, options.limit),
      description:
        "Finds pages related to a page. Only available when `search.status().capabilities.related` is true.",
      parameters: [
        { name: "page", type: "string", description: "Page name." },
        {
          name: "options",
          type: "table",
          description: "`limit`: maximum number of pages.",
          optional: true,
        },
      ],
      returns: [{ type: "table", description: "`{items, waitingForIndex}`." }],
    },
  };
}
