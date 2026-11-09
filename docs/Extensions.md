---
description: "Extend SilverBullet with libraries, Space Lua or plugs."
tags: glossary
---
Install a library for ready-made commands and templates, write Space Lua for your own behavior, or develop a plug for integrations that need TypeScript.

# Libraries
[[Library|Libraries]] are collections of [[Space Lua]] scripts, templates, and pages that you can install into your space via the [[Workbench/Libraries|Library Manager]]. They are the primary extension mechanism and the easiest way to add new features. Libraries can define:

* Custom [[Command|commands]]
* [[Slash Templates]]
* [[Page Template|Page templates]]
* [[API/widget|Widgets]]
* [[Space Style]] customizations
* [[Virtual Pages]]

Libraries are distributed as SilverBullet spaces themselves (typically via Git repositories), and managed through the [[Workbench/Libraries|Library Manager]].

# Space Lua
[[Space Lua]] is SilverBullet’s embedded scripting language. You can write scripts directly in `space-lua` fenced code blocks on any page under `Library/`, such as [[^Library/Config]]. These scripts are active across your entire space and can define functions, commands, widgets, event handlers, and more.

Space Lua is the foundation that libraries are built on. See [[Space Lua]] for a full guide.

# Plugs
[[Plugs]] are the lower-level extension mechanism, written in TypeScript and bundled as `.plug.js` assets that run in browser web workers. Built-in plugs handle features such as object extraction and task commands. Plugs have access to lower-level integration points and require their own build and distribution workflow. Start with a library or Space Lua unless you need a plug’s TypeScript environment or integration hooks.
