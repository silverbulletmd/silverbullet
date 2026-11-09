---
description: "A page under Library/, or CONFIG, that configures or extends your space."
tags: glossary
references:
- plug-api/lib/tool_pages.ts
---
Tool pages are pages not core to your content, but function as a way to configure, or extend your [[Space]]. Every page whose name starts with `Library/` is a tool page, and so is [[CONFIG]].

The most obvious examples are part of SilverBullet’s [[^Library/Std]] library and include generally useful [[^Library/Std/Infrastructure/Slash Templates]].

[[Space Lua]] and [[Space Style]] blocks only run from tool pages. Put your own scripts and styles on pages under `Library/`, for instance `Library/myname/Styles`. A `space-lua` or `space-style` block on any other page is shown, but never runs, and gets a lint warning.

A `space-lua` block that must configure the space before syncing, indexing or first render can opt in with a `-- boot: true` line, see [[Space Lua#Definition loading]].

# How are tool pages identified?
By location alone: a page named `CONFIG`, or with a name starting with `Library/`. Tags play no part. A page called `Library` (without a slash) or `LibraryNotes/x` is not a tool page.

At a technical level tool pages are [[Page|pages]] like any other, and they are indexed like any other page: tags, links, tasks, items and data blocks all end up in the [[Object Index]]. Their location decides only two things: which `space-lua` and `space-style` blocks run, and whether a page counts as tooling or content. The [[Page Picker]], [[Tool Picker]], [[File Tree]] and [[Search]] use that split, as does `index.contentPages()`.

# How do you link to tool pages?
You can link to a tool page like any other page, that is using the `[[page name]]` syntax. However, in the context of regular content, tool pages will not appear in auto complete. To get auto completion for tool pages, you can use the `[[^page name]]` caret syntax. More information: [[Link#Caret page links]].
