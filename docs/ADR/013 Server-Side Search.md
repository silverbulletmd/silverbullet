---
tags: adr
status: accepted
date: "2026-11-03"
deciders: "[[Zef Hemel]]"
owner: "[[Zef Hemel]]"
lastReviewed: "2026-11-09"
related:
  - "[[ADR/001 Offline-First PWA]]"
  - "[[ADR/007 Core Application Logic on the Client]]"
  - "[[ADR/010 Rust Backend]]"
references:
- server-search/src/fulltext/mod.rs
- server-search/src/semantic/mod.rs
- client/search/server_search.ts
- client/plugos/syscalls/search.ts
---
# Context
SilverBullet had no built-in full-text [[Search]]. Users relied on [Silversearch](https://github.com/MrMugame/silversearch), a third-party library whose license keeps it out of core.

The obvious design would follow [[ADR/001 Offline-First PWA]] and [[ADR/007 Core Application Logic on the Client]]: index and search in the client, so search keeps working offline. Silversearch shows this can work, but it is expensive. Every client builds and stores its own full-text index of the whole space.

[[Revisions]] already set a precedent: they live in server-side git and aren’t available offline in the Server’s web client. Running git in the browser and syncing the full history to every client wasn’t worth what it would buy.

# Decision
Search runs on the server only. The server keeps one index per space, updates it as pages change, and answers queries from any connected client.

* **Full-text search** uses [tantivy](https://github.com/quickwit-oss/tantivy), a Rust search library similar to Lucene. It is always on and fast enough for search-as-you-type.
* **Semantic search** is a second, opt-in engine (**Admin > Search**). It embeds page content with a model that runs locally on the server, and also powers the “Related Pages” widget. It is off by default because you have to download a model first, and indexing a large space can take a long time. No content ever leaves the server.

# Consequences
## Positive
* **The space is indexed once**, not once per client.
* **Search quality isn’t capped by the browser.** A native search library and local embedding models aren’t practical to run in every client.

## Negative / trade-offs
* **No search offline in the Server’s web client.** This deliberately deviates from [[ADR/001 Offline-First PWA]]. Don’t “fix” it without revisiting this ADR.
* **The server is no longer just a file store.** [[ADR/010 Rust Backend]] describes a server that does very little; search adds indexing work, disk space for the index and, with semantic search on, model inference.

# Alternatives considered
* **Client-side full-text index (the Silversearch approach).** Rejected as the default because every client pays the full indexing cost. Silversearch stays useful for people who need search offline in the web client, so the two coexist.
