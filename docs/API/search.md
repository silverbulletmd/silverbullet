---
tags: api/syscall
references:
- plug-api/syscalls/search.ts
- client/plugos/syscalls/search.ts
- plug-api/lib/fuzzy.ts
- client/search/segments.ts
- client/search/server_search.ts
- plug-api/types/search.ts
- server-search/src/types.rs
---

The `search` API searches the space with its active search backend and exposes SilverBullet’s fuzzy ranker to any [[Space Lua]] code.

<!--#lua spacelua.renderApiDocumentation("search") -->
## search.find

`search.find(query, options?)`

Searches the space with its active search backend. A newer search from the same tab cancels an older one that is still running. Queries shorter than the server's minimum return no results.

**Parameters:**

- `query` (`string`) — What to search for.
- `options?` (`table`) — `mode` (one of `search.status().capabilities.modes`; defaults to the first), `scope` (`pages`, `meta` or `all`, like the page picker's segments; defaults to `all`), `include`/`exclude` (exact page names; when given they override `scope`), `limit` (maximum pages).

**Returns:**

- `table` — `{items, total, partial, notice}`. Each item is `{page, pos, line, heading, excerpt, highlights}`; `heading` is set when the backend knows it, `pos` is the match's position in the page, `highlights` is a list of `[start, end]` pairs (UTF-16 offsets into `excerpt`, end exclusive).

**Example:**

```lua
local result = search.find("garden plan", {scope = "pages"})
for _, m in ipairs(result.items) do print(m.page, m.excerpt) end
```

## search.rank

`search.rank(objects, phrase, options?)`

Fuzzy-ranks objects against a phrase, best match first. The same ranker view panels use for filtering.

**Parameters:**

- `objects` (`table`) — Objects to rank.
- `phrase` (`string`) — Phrase to match against. An empty phrase returns every object, in the order given.
- `options?` (`table`) — Ranking options. `fields` maps a field name to its weight, or to `{ weight, segments = true }` to also score the parts of a `/`-separated value.

**Returns:**

- `table` — The matching objects, best match first.

## search.related

`search.related(page, options?)`

Finds pages related to a page. Only available when `search.status().capabilities.related` is true.

**Parameters:**

- `page` (`string`) — Page name.
- `options?` (`table`) — `limit`: maximum number of pages.

**Returns:**

- `table` — `{items, waitingForIndex}`.

## search.status

`search.status()`

Reports the space's search backend: its name, the query modes it supports (the first is the default), whether it can find related pages, and whether it is ready.

**Returns:**

- `table` — `{backend, model, capabilities = {modes, related}, ready, progress, reason}`. `backend` is nil when search is unavailable; `reason` says why.
<!--/lua-->

## Field weights
`options.fields` decides what the phrase is matched against, and how much each field counts. A bare number is the weight; `{ weight, segments = true }` additionally scores the parts of a `/`-separated value, which is what makes `pro alp` find `Projects/Alpha`. Per-field scores are combined, so an object matching two weighted fields outranks one matching either alone.

```lua
search.rank(objects, "pro alp", {
  fields = {
    name = { weight = 1.0, segments = true },
    aliases = 0.85,
    description = 0.5,
  },
})
```
