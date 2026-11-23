---
description: "A page under Library/ that configures or extends your space."
tags: glossary
references:
- plug-api/lib/library_pages.ts
---
A Library page is any page in the `Library/` folder of your [[Reference/Concepts/Space]]. The Library holds everything that configures or extends your space, apart from your content: your configuration page, [[^Library/Config]], your own scripts and styles, and the [[Reference/Concepts/Library|libraries]] you install.

The most obvious examples are part of SilverBullet’s [[^Library/Std]] library and include generally useful [[^Library/Std/Infrastructure/Slash Templates]].

[[Reference/Space Lua]] and [[Reference/Theming/Space Style]] blocks only run from Library pages. Put your own scripts and styles on pages under `Library/`, for instance `Library/myname/Styles`. Configuration lives on `Library/Config`, whose blocks always run at boot. A `space-lua` or `space-style` block on any other page is shown, but never runs, and gets a lint warning.

A `space-lua` block that must configure the space before syncing, indexing or first render can opt in with a `-- boot: true` line, see [[Reference/Space Lua#Definition loading]].

# How are Library pages identified?
By location alone: a page whose name starts with `Library/`. Tags play no part. A page called `Library` (without a slash) or `LibraryNotes/x` is not a Library page, and neither is a page called `CONFIG`, the old location of the configuration page.

At a technical level Library pages are [[Reference/Concepts/Page|pages]] like any other, and they are indexed like any other page: tags, links, tasks, items and data blocks all end up in the [[Object Index]]. Their location decides only two things: which `space-lua` and `space-style` blocks run, and whether a page counts as a Library page or as content. The [[Page Picker]], [[Library Page Picker]], [[Space Tree]] and [[Features/Search]] use that split, as does `index.contentPages()`.

# How do you link to Library pages?
You can link to a Library page like any other page, that is using the `[[page name]]` syntax. However, in the context of regular content, Library pages will not appear in auto complete. To get auto completion for Library pages, you can use the `[[^page name]]` caret syntax. More information: [[Link#Caret page links]].
