---
tags: adr
status: accepted
date: "2025-08-29"
deciders: "[[Zef Hemel]]"
owner: "[[Zef Hemel]]"
lastReviewed: "2026-06-19"
---
# Context
SilverBullet's [[Plugs]] runtime was originally designed so that plugs could run **either on the server or in the client**. Through “v1” this surfaced as two switchable modes:

* **Server mode** — indexing and plug execution ran on the server, the client delegated a lot of logic to the server.
* **Sync mode** — the space is *also* synced to the browser and indexing + plug execution ran client-side as well; you could switch between the two.

This was flexible and genuinely powerful, but maintaining **two runtime environments** for PlugOS was a persistent burden: every capability had to work and the dual model produced subtle, hard-to-diagnose issues. The goal for v2 was to be genuinely **offline-first** without that complexity.

# Decision
v2 **eliminates the server-side PlugOS runtime**: plug execution, indexing, the query engine, [[Space Lua]], page rendering, and the [[Sync|sync engine]] now run **only in the client**. In effect, **sync mode becomes the only mode**, and the **server is reduced to a file store** — it lists, reads, writes and deletes files, handles authentication, serves the static client, and runs shell commands. See [[Architecture]].

# Consequences
## Positive
* **One runtime, not two.** Removing the server-side execution environment ended the parity burden and the class of subtle dual-mode bugs — the core motivation.
* **Offline-first by construction** — the client keeps a full local copy of the space, so it keeps working with no server reachable.
* **No round-trips for logic** — queries and index lookups are local, keeping the UI responsive.
* **The server became trivial and swappable.** Because it only moves bytes, the whole backend could be re-implemented in another language without changing application behaviour — what made subsequent server migrations cheap (see [[ADR/010 Rust Backend]]).
* **Cheap to self-host** — a minimal file-serving process is all that is required. Memory usage was reduced from a few hundred MB to single to low-double digits.

## Negative / trade-offs 
* **Every client builds and holds its own copy.** Each browser/device must sync all files locally and (re)create its own [[Object Index|object index]] from scratch — duplicated storage and a cold-start indexing cost on every new client, instead of indexing once on the server. Partly mitigated by selective sync (e.g. [[Document|documents]] are fetched on demand) — see [[Sync]].
* **No thin-client / server-only option.** Large spaces or constrained, low-power devices that could previously lean on server mode no longer can — there is no mode where the heavy lifting stays on the server.
* **Server-authoritative features are harder.** Anything needing a central source of truth at edit time — notably real-time collaboration / CRDT merging — does not fall out naturally; concurrent edits are resolved by writing a conflicting copy rather than merging. See [[ADR/002 Sync Engine]].

# Alternatives considered
* **Keep the dual-mode (server + sync) architecture.** Rejected: maintaining two PlugOS runtimes in parity was the core pain — an ongoing maintenance burden and a source of subtle bugs. It was also confusing for plug developers.
* **Make *server mode* the only mode** (thin client; the server does everything). Rejected: defeats offline-first and the run-anywhere goal, and keeps the product tied to an always-available, more capable backend.

# References
* [[Architecture]] — "all indexing, querying etc. happens in the client. The server effectively acts as a file store."
* [SilverBullet v2 released](https://community.silverbullet.md/t/silverbullet-v2-released/3100) (2025-08-29)
