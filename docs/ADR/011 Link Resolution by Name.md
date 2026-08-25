---
tags: adr
status: accepted
date: "2026-08-24"
deciders: "[[Zef Hemel]]"
owner: "[[Zef Hemel]]"
dependsOn:
  - "[[ADR/007 Core Application Logic on the Client]]"
related:
  - "[[ADR/003 Indexed Object Graph]]"
  - "[[ADR/010 Rust Backend]]"
references:
- plug-api/lib/resolve_path.ts
- plugs/index/relation.ts
- plugs/index/requalify.ts
- plugs/index/invalidate.ts
- client/codemirror/wiki_link_processor.ts
- server/src/link_resolve.rs
---
# Context
SilverBullet from day 1 has resolved `[[wiki links]]` as absolute, case-sensitive paths from the space root. Other tools, notably Obsidian, works differently: Obsidian resolves a bare `[[Note]]` by case-insensitive name lookup across the whole vault (Obsidian speak for Space), and its default link format *writes* bare names wherever they are unique. Two problems followed:

1. **Obsidian interop:** An Obsidian-authored vault is full of links SilverBullet could not resolve, blocking a docs-as-code use case where one team mixes both tools on the same repo. The incompatibility was one-directional: SilverBullet’s absolute links resolve fine in Obsidian.
2. **Root dependence:** A full path link encodes where the space root is. Open the same folder one level higher (not that uncommon in the docs-as-code use case) and every link breaks.

This has been discussed in the community various time, e.g. [here](https://community.silverbullet.md/t/smart-filename-path-resolve/2453).

# Decision
While alternatives like having a “resolution-mode” were considered (e.g. an “obsidian mode”), this would just lead to a lot of complication and weird behavior when switching mode. Instead, we’re updating the current link resolving algorithm to (ideally) support both schemes simultaneously and the only configuration to be set is the preferred link writing format.

The rules:
1. **Exact path match wins.** Every link that resolved before resolves to the same file. That is: if a link is an absolute one, and that path exists — done.
2. **Bare names** (so without a path segment) resolve space-wide by name, case-insensitively, exact-case preferred.
3. **Qualified paths** (with a path segment, but not necessarily a full one) with no exact match are looked up by unique **path suffix** (`[[api/Auth]]` finds `docs/api/Auth`). This matches Obsidian’s partial paths and making qualified links survive a root change too. Example: [[1/ambiguous link]] (note that the `1/` prefix make it ambiguous, but it’s still not a full path).
4. **Several matches** mean the link is **ambiguous**: it still resolves, but is highlighted, indexed as an [[Object/ambiguous-link]] object, and following it (click, command or shortcut) opens a picker over the candidates. The link text is left alone: following a link is reading, and reading does not edit the document, example: [[ambiguous link]]

The scope is wiki links only, including documents (`![[image.png]]`) and [[Transclusions]]. The `[[^` meta-page link syntax is not included here (it always will continue to use absolute paths). Markdown links keep their existing folder-relative semantics. The [[ADR/003 Indexed Object Graph|index]] keeps storing resolved absolute paths, so queries, backlinks and the graph never see write format.

There is now a “Link write format” configuration option in the [[Configuration Manager]] that allows you to choose either: `shortest`, `shortest-suffix`, or `full-path`. See [[Link#Link write format]] for details.

# Consequences
## Positive
* Obsidian vaults just work, so improved interoperability.
* (Most) links survive a change of space root: bare and suffix-qualified links don’t encode the root.
* For people using heavily nested spaces: links are now shorter (usually).

## Negative / trade-offs
* **Semantics change, slightly:** A previously [[Aspiring Pages]] link may now (silently) gain a target.
* **Renames rewrite backlinks into bare form** in hierarchical spaces: switching `linkWriteFormat` back to `full-path` re-qualifies nothing already written bare.
* **Resolution is stateful:** A file appearing or disappearing changes what links *elsewhere* mean.

# Alternatives considered
* **Obsidian import tooling/commands.** Rejected: re-breaks on every Obsidian save in a mixed team, and bakes the root into every link.
* **A resolution mode switch** (`absolute` | `shortest`). Rejected: two resolution semantics in one codebase, too complicated and a pain to maintain.
