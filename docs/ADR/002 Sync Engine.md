---
tags: adr
status: accepted
date: "2022-04-06"
deciders: "[[Zef Hemel]]"
owner: "[[Zef Hemel]]"
dependsOn:
  - "[[ADR/001 Offline-First PWA]]"
related:
  - "[[ADR/010 Rust Backend]]"
---
# Context
Because the client keeps a full local copy of the space ([[ADR/001 Offline-First PWA]]), it has to be reconciled with the server's copy. A [[Sync]] engine keeps the client's local copy and the server's files in agreement, in both directions, including after offline edits.

# Decision
Sync is **file-level, bidirectional, and poll-based**, running in the service worker (see [[Sync]]):

* the whole space syncs roughly every 20 seconds, the currently open file every 4–5 seconds;
* it reconciles **whole files** by comparing local and remote state, not character-level diffs;
* on a **conflict** (the same file changed in two places) it does **not merge** — it writes a **conflicting copy** and notifies you.

At the time of this decision, more more modern approaches like CRDTs were not yet very mature and integrating them was deemed too complex. At various stages such integration was attempted, but later removed because of too many edge cases.

# Consequences
## Positive
* **Simple.** Whole-file sync with conflict-copies is easy to reason about and hard to corrupt.
* **Keeps the server dumb.** File-level sync needs only list/read/write/delete, so the server stays a thin file store ([[ADR/010 Rust Backend]]) and the runtime stays swappable.
* **Offline-friendly.** Edits made offline reconcile on the next poll; no central coordinator required.

## Negative / trade-offs
* **No real-time collaboration.** Two people editing one file at once get a conflicting copy, not a live merged document.
* **Conflict copies need manual cleanup.** The user resolves the duplicates by hand.
* **Polling latency.** Changes propagate on a ~5–20s cycle, not instantly.

# Why not CRDT (yet)
A [CRDT](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type) engine would give character-level, conflict-free merging and real-time collaboration. It was deferred, not rejected forever:

* while the backend was Go, the CRDT ecosystem there was immature ([issue 1902](https://github.com/silverbulletmd/silverbullet/issues/1902)), making it a poor bet.
* for a primarily single-user, offline-first tool, whole-file conflict-copies are a reasonable and much simpler default.

The move to a Rust backend ([[ADR/010 Rust Backend]]) shifts that calculus — the Rust CRDT ecosystem is stronger — so a CRDT-based sync / real-time collaboration may be revisited. If adopted, it would supersede this decision.

# Alternatives considered
* **CRDT-based sync (e.g. Yjs).** Deferred — see above.
* **Last-writer-wins (silently overwrite on conflict).** Rejected: risks silent data loss; a conflicting copy is safer.
* **Server-side merge or locking.** Rejected: makes the server authoritative and stateful, breaking the thin-server model ([[ADR/007 Core Application Logic on the Client]], [[ADR/010 Rust Backend]]).

# References
* [[Sync]] · [[Architecture#Service Worker]].
* Real-time collaboration added, then removed (2023): [PR 411](https://github.com/silverbulletmd/silverbullet/pull/411).
* CRDT considered a no-go in the Go era: [issue 1902](https://github.com/silverbulletmd/silverbullet/issues/1902).
