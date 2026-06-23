---
tags: adr
status: accepted
date: "2024-10-03"
deciders: "[[Zef Hemel]]"
owner: "[[Zef Hemel]]"
lastReviewed: "2026-06-19"
related:
  - "[[ADR/003 Indexed Object Graph]]"
---
# Context
SilverBullet lets users put dynamic content: live queries, computed views, templated rendering, and custom logic directly in their pages. In v1 this was spread across **three separate mechanisms**, each with its own syntax:

* a custom **query language** for live queries (originally HTML-comment "directives");
* **Handlebars-style templates** (Live Templates, Live Template Widgets, Page Templates) for rendering;
* **Space Script**, a **JavaScript** layer, for custom functions and logic.

Three languages to learn and maintain, with awkward seams between them (a query feeding a Handlebars template feeding a JS function).

# Decision
Adopt **Lua** as a single embedded language ([[Space Lua]]) that unifies scripting, templating, and querying:

* `space-lua` code blocks define space-wide functions and config;
* `${...}` expressions render inline via [[Live Preview]], replacing Handlebars templates;
* **Space Lua Integrated Query (SLIQ)** — `${query[[ from ... select ... ]]}` replaces the old query language; because the body after `from` is a Lua expression, it can query the [[Object Index|object index]] *or* any Lua table.

[[Space Lua]] is a **custom, from-scratch implementation** — not the official [Lua](https://www.lua.org) or [LuaJIT](https://luajit.org), nor a WebAssembly build of them — largely Lua-5.4-compatible with a few non-standard additions. It replaced Space Script (JS) and the v1 template/query mechanisms.

Writing our own interpreter (for partly historical reasons) bought a very smooth interoperability story: friction-free access to a lot of SilverBullet and browser functionality, and deep enough integration with the Lua runtime to support editor features like code completion and jump-to-definition. It also opened the path to develop SilverBullet-specific language extensions, specifically [[Space Lua/Integrated Query]] that otherwise would have been impossible.

# Consequences
## Positive
* **One language instead of three.** Queries, templates, and scripting share one syntax and runtime — far less to learn and maintain.
* **Composable.** A query can call a template function in its `select`, and expressions can call space-wide functions — no seams between separate engines.
* **Embeddable and safe.** Lua is small and designed to be embedded and sandboxed — a better fit than JavaScript for user code running inside the app.
* **Deep, friction-free integration.** Because the interpreter is our own rather than a black-box VM, Lua interoperates smoothly with SilverBullet and browser APIs, and the runtime can power editor features like (some) code completion and jump-to-definition.

## Negative / trade-offs
* **A custom Lua dialect to maintain.** Space Lua is its own implementation, with ongoing work to track Lua 5.4 semantics.
* **Less familiar than JavaScript.** Most web developers know JS, not Lua — a higher initial learning curve (offset by Lua's small surface).
* **Migration cost.** This shift was a hard breaking change transitioning from v1 to v2, and spaces using directives / Handlebars / Space Script had to be ported. We likely lost users over this, see [[Migrate from v1]].

# Alternatives considered
* **Keep JavaScript (Space Script) + Handlebars + the old query language.** Rejected: three languages and the seams between them, and JS is awkward to sandbox safely for in-space user code.
* **Embed an existing Lua (a WebAssembly build, Fengari, or LuaJIT).** Rejected: a from-scratch implementation gives a far smoother interoperability story with SilverBullet and browser functionality, and allows the deep runtime integration (code completion, jump-to-definition) a black-box VM would not, it also allowed to repurpose Lua for [[Space Lua/Integrated Query]].

# References
* First Lua integration: [commit 3cf7b72e](https://github.com/silverbulletmd/silverbullet/commit/3cf7b72e) (2024-10).
* [[Space Lua]] · [[Space Lua/Integrated Query]] · [[Migrate from v1]] — what changed from directives / Handlebars / Space Script.
