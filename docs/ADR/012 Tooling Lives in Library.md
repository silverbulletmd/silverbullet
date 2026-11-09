---
tags: adr
status: accepted
date: "2026-11-09"
deciders: "[[Zef Hemel]]"
owner: "[[Zef Hemel]]"
lastReviewed: "2026-11-09"
dependsOn:
  - "[[ADR/005 Space Lua]]"
related:
  - "[[ADR/003 Indexed Object Graph]]"
  - "[[ADR/001 Offline-First PWA]]"
references:
- client/boot.ts
- client/space_lua.ts
- client/space_style.ts
- client/client_system.ts
- plugs/index/space_lua.ts
- plugs/index/space_style.ts
- client/workbench/libraries/library_names.ts
- server-common/src/space/embed.rs
---
# Context
Since [[ADR/005 Space Lua|Space Lua]] landed, `space-lua` and `space-style` blocks could live on any page. Two problems followed:

1. **Scattered tooling.** Scripts and styles end up spread across a space, mixed in with content, so it's hard to see what customizes a space. To help separate the two, we introduced the “meta page”: a page tagged `#meta`. It is a nerdy, tag-based concept that users have to opt into.
2. **Boot depends on the index.** Because scripts can be anywhere, the only way to find them is the [[ADR/003 Indexed Object Graph|object index]]. Boot runs a configuration pre-pass over four hardcoded pages, then loads scripts and styles from the index. On a fresh client nothing loads until the whole space is indexed. When indexing finishes, everything is reloaded and the editor rebuilt. Styles and fonts wait the same way. This is slow, and every step adds special cases.

# Decision
**Tooling lives under `Library/`, plus the root `CONFIG` page.** Pages there are **Tool Pages**, a term that replaces “meta page”. Only blocks on Tool Pages run. A `space-lua` or `space-style` block anywhere else is ordinary code: it is shown but never runs. It gets a lint warning, which a configuration option can turn off.

* **Defined by location, not by tag.** The `meta/...` tags keep their discovery role (templates, libraries, repositories), but a bare `#meta` tag no longer means anything.
* **Loading without the index.** The server serves the raw text of all Tool Pages in one response. A single client function extracts and orders the blocks, and boot and `System: Reload` share it. When synced, the service worker answers the same request from its local copy, so offline boot works. Rust never parses Markdown.
* **One ordering for scripts and styles.** Priority first, highest first, where no priority counts as 0. Ties are broken by page name, then by position on the page.
* **Indexing is unchanged**, except that `space-lua` and `space-style` objects are only produced for Tool Pages.
* **Repositories move to `Library/Repository/`.** New library and repository installs always land under `Library/`. Existing repository pages are not migrated. The Library Manager offers to move them.
* **Rename.** The UI says “Tool” and uses the tool icon. Lua APIs get `tool` names, and the old `meta` names keep working as aliases.

# Consequences
## Positive
* Faster boot, especially on a fresh client: one request, with no wait for indexing and no reload-and-rebuild once it finishes.
* Styles apply at boot, so pages no longer flash unstyled.
* Fewer special cases in the boot code.
* Easier to explain: everything that customizes a space lives in `Library/`, plus CONFIG.
* Docs and examples can use real `space-lua` / `space-style` fences outside `Library/`. They get syntax highlighting, copy cleanly, and never run.

## Negative / trade-offs
* **Breaking change.** Blocks outside `Library/` and CONFIG silently stop running. Users find out through the lint warning and the changelog though.
* Pages tagged `#meta` outside `Library/`, such as templates, now count as content in pickers and in `index.contentPages()`.
* Repository pages that are never moved count as content until the user moves them.
* Two places can serve the tooling payload, the server and the service worker. A test keeps them in step.

# Alternatives considered
* **Keep scripts anywhere and speed up the index path.** Rejected: boot would still depend on indexing the whole space, and tooling would stay scattered.
* **Concatenate all blocks into one Lua chunk.** Rejected: each block's identity (`page@pos`) drives error locations, quarantine, the per-script time budget and the Workbench inspector.
* **Extract blocks in Rust.** Rejected: a second Markdown parser would drift from the client's, for example on commented-out blocks or fences inside lists.
* **Index Tool Pages only partially.** Rejected: renames, backlinks, heading links and data-block tooling all depend on full indexing, and the gain was small.
* **Define Tool Pages by tag, or by tag or location.** Rejected: it keeps the opt-in concept alive and doesn't give boot a fixed place to look.
