---
description: A thin page whose body is primarily drived through queries that collects items from across your space.
tags: glossary guide
---
An aggregator page is a thin page whose body is primarily drived through queries that collects items from across your space.

Instead of hand-maintaining a list of all open questions, all ADRs, or all team members, you tag each item on its natural home page and let a single query page assemble the collection automatically. Add an item anywhere in your space, tag it, and the aggregator picks it up automatically.

# The pattern
Three moving parts combine to make an aggregator:

**1. A tag** you apply to items on their natural home page, for example, `#open-question` on any page that tracks an open question.

**2. An aggregator page** whose body is a single [[Space Lua/Integrated Query|SLIQ]] query that pulls everything carrying that tag:

```lua
${query[[
  from t = index.contentPages("open-question")
  order by t.name
  select templates.pageItem(t)
]]}
```

The query lives inside `${...}` and renders as a live widget in [[Live Preview]]. Because the prose body explains the pattern, the page retains value even outside SilverBullet.

**3. A `tagPage` mapping** in [[CONFIG]] so clicking the tag in the editor jumps straight to the aggregator overview:

```lua
tag.define {
  name = "open-question",
  tagPage = "Open Questions",
}
```

See [[API/tag#tag.define(spec)]] for the full list of options `tag.define` accepts.

# Why aggregators beat hand-maintained lists
- **Zero maintenance** — to add an item, tag it on its home page; the aggregator updates itself on the next index cycle.
- **No drift** — the list is always exactly what the index says it is; typos or deletions surface instantly.
- **Single source of truth** — the item's data lives once, on the item's own page; the aggregator is just a view.

# Recipe
To set up a new collection:

1. **Pick a tag** — choose a short, lowercase, hyphenated name (`meeting-note`, `open-question`, `decision`).
2. **Write the aggregator page** — create a page (e.g. `Open Questions`) whose body is the SLIQ query above, substituting your tag. Use `index.contentPages("tag")` to filter out [[Meta Page|Meta Pages]]; use `index.objects("tag")` if you also want items from meta pages.
3. **Register `tagPage` in [[CONFIG]]** — add a `tag.define` block so clicking the tag navigates to your aggregator. Place `tag.define` calls in `CONFIG` so they run during the index phase.
4. **Link the overview from your index or catalog page** — add a `[[Open Questions]]` link wherever people would naturally look for the collection.

# Examples in this manual
This docs space already uses the pattern for two collections:

- **[[ADR]]** — aggregates all pages tagged `adr`; the `tag.define` in [[CONFIG]] maps `tagPage = "ADR"`.
- **[[Architecture]]** — aggregates all pages tagged `component`; mapped via `tagPage = "Architecture"` in [[CONFIG]].

Open either page to see a live query-driven aggregator with no hand-maintained list.
