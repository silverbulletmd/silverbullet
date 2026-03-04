---
description: A plug or library that adds functionality to SilverBullet.
tags: glossary
---

There are several ways to extend the functionality of SilverBullet:

# Libraries
[[Library|Libraries]] are collections of [[Space Lua]] scripts, templates, and pages that you can install into your space via the [[Library Manager]]. They are the primary extension mechanism and the easiest way to add new features. Libraries can define:

* Custom [[Command|commands]]
* [[Slash Templates]]
* [[Page Template|Page templates]]
* [[API/widget|Widgets]]
* [[Space Style]] customizations
* [[Virtual Pages]]

Libraries are distributed as SilverBullet spaces themselves (typically via Git repositories), and managed through the [[Library Manager]].

# Space Lua
[[Space Lua]] is SilverBullet's embedded scripting language. You can write scripts directly in `space-lua` fenced code blocks on any page. These scripts are active across your entire space and can define functions, commands, widgets, event handlers, and more.

Space Lua is the foundation that libraries are built on. See [[Space Lua]] for a full guide.

# Plugs
[[Plugs]] are the lower-level extension mechanism, written in TypeScript and compiled to WebAssembly. SilverBullet's core functionality (editing, indexing, syncing) is itself implemented as plugs. While more powerful than Space Lua, plugs are harder to develop and distribute. Most users will not need to write plugs — Space Lua and libraries cover the vast majority of use cases.
