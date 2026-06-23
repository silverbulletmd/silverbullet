---
tags: adr
status: accepted
date: "2026-03-10"
deciders: "[[Zef Hemel]]"
owner: "[[Zef Hemel]]"
lastReviewed: "2026-06-19"
dependsOn:
  - "[[ADR/007 Core Application Logic on the Client]]"
related:
  - "[[ADR/010 Rust Backend]]"
---
# Context
Since [[ADR/007 Core Application Logic on the Client|v2]] the client is where all the logic lives, and it is built with TypeScript + ESBuild. For years that toolchain ran on **Deno**, chosen early when Deno's sandboxed-worker permissions also suited running [[Plugs|plugs]] on the server (see [[ADR/010 Rust Backend]]).

Once the server became a thin file store, only the client remained to build, and the trade-off shifted: Deno's distinctive advantages no longer bought SilverBullet much, while its churn — repeated changes in package management (HTTP imports → import maps → JSR → varying npm support) and the occasional regression — was a recurring distraction.

# Decision
The client build toolchain moved from **Deno to Node.js** (npm + ESBuild, with [vitest](https://vitest.dev/) for tests). It was done gradually and completed in the `to-node` migration.

# Consequences
## Positive
* **Lower barrier to contribution.** Far more developers know Node/npm than Deno.
* **Richer ecosystem.** Unlocked [biome](https://biomejs.dev) for formatting/linting and a [Playwright](https://playwright.dev/) end-to-end test suite.
* **Off a moving target.** No longer tracking Deno's shifting package-management story.

## Negative / trade-offs
* **More moving parts.** Deno bundled fmt/lint/test out of the box; on Node these are assembled from separate packages (biome, vitest), a slightly larger dependency surface.
* **Left the "better" runtime.** Deno is arguably the nicer JS runtime; the move trades that for familiarity and ecosystem reach.

# Alternatives considered
* **Stay on Deno.** Rejected: with only the client left to build, Deno's specific benefits no longer justify the unfamiliarity and thinner ecosystem.
* **Switch to Bun.** Rejected: less mature than Node, and maturity is weighted heavily in stack choices.

# References
* Client toolchain migration: [PR1839](https://github.com/silverbulletmd/silverbullet/pull/1839).
* Blog: [On Tech Stacks](https://no.silverbullet.plus/tech-stacks) — the decision criteria behind these moves.
