---
description: "Explore data, build queries, run Lua and manage your space’s configuration and extensions."
references:
- client/workbench/**
- client/navigator/views/workbench.ts
---
The workbench is where you shape and understand your space: look through your data, build queries, experiment with [[Space Lua]], and see how your scripts and styles load.

You can open the panel via ${widgets.commandButton("Workbench: Toggle")}.

The workbench has the following tabs:

* [[Workbench/Overview|Overview]]: your space at a glance: page, task and link counts, top tags, activity and runtime state.
* [[Workbench/Configuration|Configuration]]: your space’s configuration options and key bindings, saved to [[CONFIG]].
* [[Workbench/Data|Data]]: browse the objects in your space by tag, shape them into a [[Space Lua/Integrated Query|query]] without writing it, and define the tags' [[Schema|schemas]].
* [[Workbench/Code|Code]]: every `space-lua` block in your space and how loading it went ([[Workbench/Scripts|Space Lua]]), and every `space-style` block and whether the browser could make sense of it ([[Workbench/Styles|Space Style]]).
* [[Workbench/Libraries|Libraries]]: install, update and remove [[Library|libraries]] and [[Repository|repositories]], and check what has an update.
* [[Workbench/Health|Health]]: problems in your space, such as broken links, failed scripts, merge conflicts and (on demand) lint errors.
* [[Workbench/Console|Console]]: everything your space logs, plus a [[Space Lua]] REPL.
