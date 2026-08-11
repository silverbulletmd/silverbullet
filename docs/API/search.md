---
tags: api/syscall
references:
- plug-api/syscalls/search.ts
- client/plugos/syscalls/search.ts
- plug-api/lib/fuzzy.ts
---

The `search` API exposes SilverBullet’s fuzzy ranker to any [[Space Lua]] code.

<!--#lua spacelua.renderApiDocumentation("search") -->
## search.rank

`search.rank(objects, phrase, options?)`

Fuzzy-ranks objects against a phrase, best match first. The same ranker the navigator's own filtering uses.

**Parameters:**

- `objects` (`table`) — Objects to rank.
- `phrase` (`string`) — Phrase to match against. An empty phrase returns every object, in the order given.
- `options?` (`table`) — Ranking options. `fields` maps a field name to its weight, or to `{ weight, segments = true }` to also score the parts of a `/`-separated value.

**Returns:**

- `table` — The matching objects, best match first.
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
