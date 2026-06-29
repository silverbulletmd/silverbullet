---
tags: adr
status: accepted
date: "2022-04-06"
deciders: "[[Zef Hemel]]"
owner: "[[Zef Hemel]]"
dependsOn:
  - "[[ADR/001 Offline-First PWA]]"
related:
  - "[[ADR/002 Sync Engine]]"
  - "[[ADR/005 Space Lua]]"
references:
- client/data/object_index.ts
- plugs/index/indexer.ts
- plugs/object-graph/src/graph_builder.ts
---
# Context
SilverBullet's power features — [[Space Lua/Integrated Query]], [[Linked Mention]], the [[Linked Tasks]], [[Object Graph]] — all need *structured, queryable* data. But the source of truth is plain markdown files. Something needs to turn that prose into queryable data without making the markdown any less plain.

# Decision
Continuously maintain an **[[Object Index]]**: a structured, queryable graph automatically extracted from the markdown. Every meaningful element — [[Object/page|pages]], headers, [[Object/task|tasks]], list items, [[Tag|tags]], links — becomes an **[[Object|object]]** (a "row") with attributes, typed by one or more tags ("tables"), queried via [[Space Lua/Integrated Query]] and the [[API/index]] API.

Two principles hold it together:

* **Markdown is the source of truth.** Every indexed object has a representation in the markdown; the index is derived, can be flushed, and rebuilt from the files at any time (`Space: Reindex`). It is a cache, not the canonical store.
* **The index lives in the client.** It is built into IndexedDB in the browser ([[ADR/007 Core Application Logic on the Client]], [[ADR/001 Offline-First PWA]]) and maintained incrementally.

# Consequences
## Positive
* **Plain markdown stays plain, yet queryable.** Structure is derived, so files remain portable and human-editable; nothing is locked in a database.
* **Rebuildable and disposable.** The index is a cache. Corruption or schema changes are fixed through a reindex.
* **One uniform model.** Pages, tasks, tags, and relations are all just objects with attributes enabling one query language over everything.
* **A real graph for free.** Generalized relations turn backlinks and frontmatter links into uniform edges, enabling [[Linked Mention|backlinks]], the [[Object Graph]], renames, and semantic frontmatter (like ADR `dependsOn`/`related`).

## Negative / trade-offs
* **Every client (re)builds the index.** Indexing all files is a cold-start cost per client (see [[ADR/001 Offline-First PWA]]), large spaces take longer.

# Alternatives considered
* **A separate authored database (Notion/Confluence-style).** Rejected: breaks "markdown is the source of truth," adds lock-in and lossy export — contrary to the whole product thesis.
* **Query raw markdown text (grep-style) at query time.** Rejected: too slow and too weak, no typed attributes, no joins/graph, no incremental maintenance.

# References
* [[Object]] · [[Object Index]] · [[Object/relation]] · [[Object Graph]].
* Generalized relation: [commit 91349448](https://github.com/silverbulletmd/silverbullet/commit/91349448) (2026-05-21) — "Introduce 'relation' indexer, demote 'link' to virtual view"
