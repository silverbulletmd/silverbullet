---
tags: adr
status: accepted
date: "2026-06-16"
deciders: "[[Zef Hemel]]"
owner: "[[Zef Hemel]]"
lastReviewed: "2026-06-19"
dependsOn:
  - "[[ADR/007 Core Application Logic on the Client]]"
related:
  - "[[ADR/009 Client Build Toolchain]]"
  - "[[ADR/002 Sync Engine]]"
---
# Context
The server does very little. Since [[ADR/007 Core Application Logic on the Client|all application logic moved to the client]], the server is primarily a file store: it lists, reads, writes and deletes files, handles authentication, serves the static client, and runs shell commands. When the [[Runtime API]] is enabled, it manages a Chrome sub-process and delegates calls to it. This makes the server's *implementation language* a relatively low-stakes, swappable choice, and over the project’s life it has changed several times.

The server has been, in turn: Node.js (earliest prototypes), then **Deno** for years, then **Go** (2025), and now **Rust** (2026). (The separate move of the *client* build toolchain from Deno to Node is [[ADR/009 Client Build Toolchain|its own decision]].) This is further discussed in [On Tech Stacks](https://no.silverbullet.plus/tech-stacks).

# Decision
The server is written in **Rust** (as of v2.10.0). The progression was **Node.js -> Deno -> Go -> Rust**:

* Deno: a modern, secure-by-default TypeScript runtime; a sensible fit while the server still ran [[Plugs|plug]] logic and sandboxing mattered (pre-[[ADR/007 Core Application Logic on the Client|v2]]).
* Go (2025): once the server was just a file store, it was rewritten in Go: "significantly less memory and significantly smaller in size."
* Rust (2026): the Go server was replaced by an adaptation of the Rust backend used elsewhere in the project, converging the whole codebase on **TypeScript + Rust**.

# Consequences
## Positive
* **Fewer languages.** The stack converged from TypeScript + Go + Rust to just **TypeScript + Rust**: less to master and one backend to maintain.
* **Leaner runtime.** Rust has no garbage collector and produces a small, single statically-compiled binary; memory use drops again.
* **Opens new doors.** A Rust backend makes a future CRDT-based sync engine / real-time collaboration feasible where the Go ecosystem made it impractical — see [[ADR/002 Sync Engine]].

## Negative / trade-offs
* **Churn.** Three server rewrites is real effort, and for a while two backends were maintained in parallel before converging.
* **Steeper language.** Rust has a higher learning curve than Go or TypeScript, raising the bar for backend contributors. However, contributions to the backend were rare anyway, and generally unnecessary.

# Alternatives considered
* **Revert the server to TypeScript (Deno or Node).** Rejected: a JS runtime buys little for a process that just serves files and it is resource heavy.
* **Stay on Go.** Rejected: Go meant maintaining a backend separate from the project's Rust code, and its ecosystem made the desired CRDT direction impractical.

# References
* Go backend: [PR1555](https://github.com/silverbulletmd/silverbullet/pull/1555). Rust backend: [PR2010](https://github.com/silverbulletmd/silverbullet/pull/2010).
* Blog: [On Tech Stacks](https://no.silverbullet.plus/tech-stacks) — the decision criteria behind these moves (avoid technology zoos, maturity, leverage, fun).
