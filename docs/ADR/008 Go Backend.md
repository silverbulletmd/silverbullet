---
tags: adr
status: superseded
date: "2025-09-19"
deciders: "[[Zef Hemel]]"
owner: "[[Zef Hemel]]"
dependsOn:
  - "[[ADR/007 Core Application Logic on the Client]]"
supersededBy:
  - "[[ADR/010 Rust Backend]]"
references:
- server-common/src/space.rs
- bin/silverbullet/src/server.rs
---
# Context
The server had been a Deno-based TypeScript runtime since 2022. After [[ADR/007 Core Application Logic on the Client|v2 moved all logic to the client]], the server became a thin file store so the heavier, TypeScript-oriented Deno runtime bought little, and a leaner compiled server looked attractive.

# Decision
Rewrite the server in **Go**. Being just a file store, the whole backend was ported becoming significantly less memory and significantly smaller in size than the Deno build.

# Consequences
## Positive
* Much lower memory use and a smaller, single compiled binary than the Deno server.
* Cheap to attempt, thanks to the thin-server model ([[ADR/007 Core Application Logic on the Client]]).

## Negative / trade-offs
* Since the development of [SilverBullet+](https://silverbullet.plus/) which required adding Rust to the stack, this resulted in 3 tech stacks (TypeScript, Go and Rust).
* The Go CRDT ecosystem was immature, foreclosing a future CRDT [[ADR/002 Sync Engine|sync engine]].

# Status update
**Superseded by [[ADR/010 Rust Backend]].** The Go server was replaced by a Rust backend to converge the codebase on TypeScript + Rust and reopen the CRDT path. See [[ADR/010 Rust Backend]] for the current decision.

# References
* Go backend: [PR 1555](https://github.com/silverbulletmd/silverbullet/pull/1555).
* Superseded by the Rust rewrite: [PR 2010](https://github.com/silverbulletmd/silverbullet/pull/2010).
