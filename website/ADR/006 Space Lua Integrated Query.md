---
tags: adr
status: accepted
date: "2025-01-13"
deciders: "[[Zef Hemel]]"
owner: "[[Zef Hemel]]"
dependsOn:
  - "[[ADR/005 Space Lua]]"
  - "[[ADR/003 Indexed Object Graph]]"
---
# Context
With [[ADR/005 Space Lua|Space Lua]] as the one embedded language and an [[ADR/003 Indexed Object Graph|object index]] to query, users still need an ergonomic way to *select and transform* objects, the single most common thing they do (RFC indexes, task rollups, dashboards). Plain imperative Lua (loops, filters, maps) works but reads poorly for what is fundamentally a declarative query, and a *separate* query language would reintroduce the second-language seam that adopting Lua removed.

# Decision
Add **Space Lua Integrated Query (SLIQ)** — an SQL- and [LINQ](https://learn.microsoft.com/en-us/dotnet/csharp/linq/)-inspired query syntax embedded *inside* Lua, rather than a standalone language or a plain function API.

* Syntax: `query[[ from ... where ... order by ... select ... ]]`. The only mandatory clause is `from`; clauses can appear in any order.
* It's **backwards-compatible Lua.** `query[[...]]` is just Lua's call-with-a-long-string sugar (`query("...")`), so a program using SLIQ is still syntactically valid Lua — Space Lua simply interprets that string as a query.
* Every clause body is a **Lua expression**, so a query can run over the [[Object Index|object index]] *or any Lua table*, call Lua functions, and render a template directly in `select`.

# Consequences
## Positive
* **Declarative and familiar.** SQL/LINQ-style reads far better than hand-rolled loops for the common select/filter/aggregate task.
* **Still one language.** SLIQ is sugar *within* Lua, not a separate DSL — it preserves the "one language, no seams" win of [[ADR/005 Space Lua]] (a query can `select` a template call, use Lua helpers, etc.).
* **Uniform over any data.** Because `from` takes a Lua expression, the same syntax queries indexed objects or arbitrary in-memory tables.

## Negative / trade-offs
* **A query dialect to parse and maintain.** SLIQ is a syntax extension inside the custom Lua implementation — only feasible *because* the interpreter is our own ([[ADR/005 Space Lua]]).
* **Looks like SQL but isn't.** Reorderable clauses and Lua-expression bodies can surprise users who expect strict SQL semantics.

# Alternatives considered
* **Plain Lua only (a filter/map library API).** Rejected: verbose and imperative for what is usually a declarative query; poor readability for the most common use case.
* **A separate standalone query language (as in v1).** Rejected: reintroduces a second language and the seams between query, template, and script that [[ADR/005 Space Lua]] set out to remove.
* **Pure SQL**: implementing full SQL would be an immense project, and the gap between Lua and SQL semantics would be confusing.

# References
* [[Space Lua/Integrated Query]] — full syntax and examples.
* Introduced as "Lua Integrated Query": [PR 1205](https://github.com/silverbulletmd/silverbullet/pull/1205), later rebranded **SLIQ**.
