---
description: The local index that makes objects queryable.
tags: glossary
references:
- client/data/object_index.ts
- plugs/index/*
- plug-api/syscalls/index.ts
---
The Object Index stores [[Object|Objects]] found in your [[Space]].

You interact with it in a few ways:
* Indirectly via various other SilverBullet features such as [[Page Picker]], [[Meta Picker]], [[Linked Mention]] etc.
* Via the [[API/index]] API directly

# Indexing
## Initial indexing process
When you launch a fresh client for the first time, the object index will be built from scratch. Depending on the size of your space this can take anything between a few seconds and minutes. If the process takes longer than a few seconds, you will see progress with a blue status circle. Until this initial indexing process finishes, you will notice that things like [[API/widget|Widgets]] and [[Space Lua/Integrated Query]] are not yet rendered, this is to avoid errors and invalid data.

After the initial index process, the index will be kept up-to-date incrementally.

> **note** Asynchronous indexing lag
> After saving a page (or external tools making updates to pages in your space) the index updates in the background and can lag a few seconds. A query run immediately after an edit _may_ return stale results for a bit. When this happens, wait briefly and re-run before drawing conclusions.

To forcefully reindex your entire space, run the `Space: Reindex` command. Depending on the size of your space, this can take anywhere from a second to minutes or longer.

## Indexing process
Objects are stored in your browser’s IndexedDB, implemented as a thin abstraction layer on top of [[API/datastore]]. Objects are always attached to a particular page.

When SilverBullet detects a page change (either via the editor or based on watching the file system for changes), it will queue reindexing the page.

This process follows the following steps:
1. Remove all existing page-connected objects from the database.
2. Parse the markdown, and broadcast it via the `page:index` event.
3. Various indexers do their magic, resulting in a list of found objects.
4. These objects are stored via the [[API/index#index.indexObjects(page, objects)]] API.

The indexObject API looks at the `tags` of the found objects, and for each tag:

* Looks up the tag spec (see [[API/tag#tag.define(spec)]])
* If the tag spec defines a `schema` and `mustValidate` is set to true, it will validate the object against the schema and only index the object if it passes. If `mustValidate` is not set (the default for performance reasons), no validation will happen at the indexing stage.
* If the tag spec defines a `transform` callback, it is invoked, see [[API/tag#Index augmentation]] for details.
* Stores the resulting objects with for the given tag

# Query
The Object Index is generally queried using [[Space Lua/Integrated Query]]. 

Entry points are:
* [[API/index#index.objects(tag)]], e.g.: `index.objects("page")` (or the convenience wrappers like `index.pages()`, `index.tasks()`, etc.)
* `index.contentPages(tag?)` — returns only content pages, **excluding [[Meta Page|Meta Pages]]** (pages tagged `meta` or `meta/*`).
* `index.aspiringPages()` — returns all [[Aspiring Pages]] (pages linked to but not yet created). Useful for finding broken or forward-references.
* `tags.*`: as a convenience — `tags.page` is equivalent to `index.objects("page")`

If a `metatable` is defined for a particular tag with [[API/tag#tag.define(spec)]], the metatable is set for each object for the tag.

## Common patterns
A few idiomatic recipes to get started — see [[Space Lua/Integrated Query]] for the full clause reference:

**Content pages by last modified** (most recently touched first):
```lua
${query[[
  from p = index.contentPages()
  order by p.lastModified desc
  limit 10
  select { name = p.name, modified = p.lastModified }
]]}
```

**Inbound links to a page** (everything that links to `"My Page"`):
```lua
${query[[
  from l = index.links()
  where l.toPage == "My Page"
  select { from = l.page, text = l.description }
]]}
```

**Dangling links in your own content**:
```lua
${query[[
  from t = index.aspiringPages()
  where not string.startsWith(t.page, "Library/")
  select { target = t.name, linkedFrom = t.page }
]]}
```
