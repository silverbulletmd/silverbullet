---
references:
- client/data/object_index.ts
- plugs/index/indexer.ts
- plugs/index/relation.ts
---
The [[Object Index]] is derived from space files. This page describes the lifecycle for authors of indexers and tag transforms; ordinary query entry points are on [[Object Index#Query]].

# Indexing process
Objects are stored in your browser’s IndexedDB, implemented as a thin abstraction layer on top of [[API/datastore]]. Objects are always attached to a particular page.

When SilverBullet detects a page change (either via the editor or based on watching the file system for changes), it will queue reindexing the page.

For each changed page, SilverBullet:
1. Remove all existing page-connected objects from the database.
2. Parse the markdown, and broadcast it via the `page:index` event.
3. Runs indexers to extract objects from the parse tree.
4. These objects are stored via the [[API/index#index.indexObjects(page, objects)]] API.

The `index.indexObjects` API processes each object’s root `tag` and user `tags`. For each tag, it:

* Looks up the tag spec (see [[API/tag#tag.define(spec)]])
* If the tag spec defines a `schema` and `mustValidate` is set to true, it will validate the object against the schema and only index the object if it passes. If `mustValidate` is not set (the default for performance reasons), no validation will happen at the indexing stage.
* If the tag spec defines a `transform` callback, it is invoked, see [[API/tag#Index augmentation]] for details.
* Stores the resulting objects for that tag.

Pages are indexed **concurrently**, so an indexer must never resolve one page’s markup against another page’s index entry: whether that entry exists yet depends on queue order, and two pages could end up disagreeing. Such joins belong at query time instead. [[At-Mention|At-mentions]] work this way: the mention records the nickname, and the page claiming it is joined when mentions are read.

[[Authorship|Signatures]] add a second relation kind alongside `at-mention`: `authored`. A block-ending `-- @name` signature emits one `authored` edge per name it credits, carrying a `range` into the signature text; an `authors:` frontmatter declaration emits the same kind with no `range`, crediting the whole page — the same shape a declared `recipients:` entry has. A signature also stamps `by` — the identity ids it credits — onto every `at-mention` relation inside the block it claims, so a query can join “who wrote this” onto “who it was addressed to” without a second pass.

