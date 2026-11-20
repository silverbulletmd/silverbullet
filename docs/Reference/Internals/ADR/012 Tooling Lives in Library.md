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
- client/tooling.ts
- server/src/handlers/tooling.rs
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

1. **Scattered tooling.** Scripts and styles end up spread across a space, mixed in with content, so it’s hard to see what customizes a space. To help separate the two, we introduced the “meta page”: a page tagged `#meta` or `#meta/*`. But this was a rather hard to understand concept that many users are confused by.
2. **Boot depends on the index.** Because scripts can be anywhere, the only way to find them is the [[ADR/003 Indexed Object Graph|object index]]. Boot runs a configuration pre-pass over four hardcoded pages, then loads scripts and styles from the index. On a fresh client nothing loads until the whole space is indexed. When indexing finishes, everything is reloaded and the editor rebuilt. Styles and fonts wait the same way. This is slow, and every step adds special cases.

# Decision
**Tooling pages (new name of meta pages) now _have to_ live under `Library/`.**

Pages there are **Tool Pages**, a term that replaces “meta page”. Only blocks on Tool Pages run. A `space-lua` or `space-style` block anywhere else is ordinary code: it is shown but never runs. It gets a lint warning, which a configuration option can turn off.

* **Defined by location, not by tag.** The `meta/...` tags keep their discovery role (templates, libraries, repositories), but a bare `#meta` tag no longer means anything.
* **Configuration moves to `Library/Config`.** The root `CONFIG` page is gone as a special location. The server renames an existing `CONFIG.md` to `Library/Config.md` when a space starts, and logs it. Links to `[[CONFIG]]` still resolve by name.
* **Loading without the index.** The server serves the raw text of all Tool Pages in one response.
* **A boot pass for configuration.** Some settings must apply before the client starts: sync settings, tag definitions the first index needs, action buttons on first render. Blocks marked `-- boot: true` run first, each on its own, in a restricted environment where only configuration calls work, and then again normally. `Library/Config` blocks always count as boot blocks.
* **One ordering for scripts and styles.** Priority first, highest first, where no priority counts as 0. Ties are broken by page name, then by position on the page.
* **The editor doesn't wait for the index.** Widgets render once scripts are loaded. On a fresh client, query results fill in while the first index runs, and an `index:ready` event lets scripts redo work that needs the full index (Std uses it for template commands).
* **Indexing is unchanged**, except that `space-lua` and `space-style` objects are only produced for Tool Pages.
* **Repositories move to `Library/Repository/`.** New library and repository installs always land under `Library/`. The server reports which repositories it ships. Existing repository pages are not migrated.
* **Rename.** The UI says “Tool” and uses the tool icon. Lua APIs get `tool` names, and the old `meta` names keep working as aliases.

# Consequences
## Positive
* A fresh client is fully usable much sooner.
* Styles apply at boot, so pages no longer flash unstyled.
* Fewer special cases in the boot code.
* Easier to explain: everything that customizes a space lives in `Library/`.

## Negative / trade-offs
* **Breaking change.** Blocks outside `Library/` silently stop running. Users find out through the lint warning.
* Pages tagged `#meta` outside `Library/`, such as templates, now count as content in pickers and in `index.contentPages()`.
* Old repository pages under `Repositories/` count as content, and show up next to the shipped ones, until the user deletes them.
* On a fresh client's first boot, query widgets show partial results and links miss tag-based decorations for a few seconds, until the first index completes.
* A script that queries the index while it loads sees empty results on a fresh client, unless it moves that work into an `index:ready` listener.

# Alternatives considered
* **Keep scripts anywhere and speed up the index path.** Rejected: boot would still depend on indexing the whole space, and tooling would stay scattered.
* **Concatenate all blocks into one Lua chunk.** Rejected: each block's identity (`page@pos`) drives error locations, quarantine, the per-script time budget and the Workbench inspector.
* **Extract blocks in Rust.** Rejected: a second Markdown parser would drift from the client's, for example on commented-out blocks or fences inside lists.
* **Index Tool Pages only partially.** Rejected: renames, backlinks, heading links and data-block tooling all depend on full indexing, and the gain was small.
* **Define Tool Pages by tag, or by tag or location.** Rejected: it keeps the opt-in concept alive and doesn't give boot a fixed place to look.
* **Drop the boot pass and reorder boot instead.** Rejected: action buttons would pop in late, indexing would have to wait for scripts, and the service worker would be configured later.
* **Run every script in the boot pass.** Rejected: every script would run twice, and library code runs only partly in the restricted environment.
* **Require `-- boot: true` on `Library/Config` too.** Rejected: one forgotten marker would make sync and tag settings apply too late, with no visible error.
* **Load scripts from the index once a client has synced.** Rejected: the index can lag behind the files, which brings back two sources of truth.
