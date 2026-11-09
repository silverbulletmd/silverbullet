---
description: The local index that makes objects queryable.
tags: glossary
references:
- client/data/object_index.ts
- plugs/index/*
- plug-api/syscalls/index.ts
---
The Object Index stores [[Object|Objects]] found in your [[Space]].

The [[Page Picker]], [[Tool Picker]] and [[Linked Mention|Linked Mentions]] use this index. Explore its records in [[Workbench/Data]], or read them through [[API/index]].

# Indexing
## Initial indexing process
The first time you open a space in a client, SilverBullet builds its index from scratch. This can take seconds or minutes, depending on the space’s size. A blue status circle shows progress if it takes more than a few seconds. [[API/widget|Widgets]] and [[Space Lua/Integrated Query|queries]] wait for indexing to finish before rendering.

After that, SilverBullet updates the index incrementally as files change.

> **note** Asynchronous indexing lag
> After saving a page (or external tools making updates to pages in your space) the index updates in the background and can lag a few seconds. A query run immediately after an edit _may_ return stale results for a bit. When this happens, wait briefly and re-run before drawing conclusions.

Run `Space: Reindex` to rebuild the entire index. This can take several minutes in a large space.

## Indexer development
For page invalidation, extraction, validation, transforms and relation construction, see [[Reference/Indexing Internals]].

# Query
The Object Index is generally queried using [[Space Lua/Integrated Query]].

Entry points are:
* [[API/index#index.objects(tag)]], e.g.: `index.objects("page")` (or the convenience wrappers for each [[Tag#Root tags|root tag]], like `index.pages()`, `index.tasks()` or `index.data()`)
* `index.contentPages(tag?)` — returns only content pages, **excluding [[Tool Page|Tool Pages]]** (pages under `Library/`).
* `index.toolPages(tag?)` — returns only [[Tool Page|Tool Pages]], the other half of the split. `index.metaPages(tag?)` is a deprecated alias.
* `index.aspiringPages()` — returns all [[Aspiring Pages]] (pages linked to but not yet created). Useful for finding broken or forward-references.
* `tags.*`: as a convenience — `tags.page` is equivalent to `index.objects("page")`

If a `metatable` is defined for a particular tag with [[API/tag#tag.define(spec)]], the metatable is set for each object for the tag.

## Common patterns
Copy these expressions into a page to display the results. See [[Space Lua/Integrated Query]] for the full clause reference:

**Content pages by last modified** (most recently touched first):
```space-lua
${query[[
  from p = index.contentPages()
  order by p.lastModified desc
  limit 10
  select { name = p.name, modified = p.lastModified }
]]}
```

**Inbound links to a page** (everything that links to `"My Page"`):
```space-lua
${query[[
  from r = index.relations("mention")
  where r.to == "My Page"
  select { from = r.page, text = r.snippet }
]]}
```

**Dangling links in your own content**:
```space-lua
${query[[
  from t = index.aspiringPages()
  where not string.startsWith(t.page, "Library/")
  select { target = t.name, linkedFrom = t.page }
]]}
```
