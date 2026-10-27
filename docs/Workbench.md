---
description: "The panel where you shape and understand your space: an overview of your space and its health, browse your objects and build queries over them, a Lua console with a unified log, overviews of your space-lua scripts and space-style styles, and a manager for your libraries."
references:
- client/workbench/**
- client/navigator/views/workbench.ts
---
The workbench is where you shape and understand your space: look through your data, build queries, experiment with [[Space Lua]], and see how your scripts and styles loaded.

You can open the panel via ${widgets.commandButton("Workbench: Toggle")}.

The workbench has the following tabs at the moment:

* [[Workbench/Overview|Overview]]: your space at a glance: page, task and link counts, top tags, activity and runtime state.
* [[Workbench/Query|Query]]: browse the objects in your space, and shape them into a [[Space Lua/Integrated Query|query]] without writing it, then put it on a page.
* [[Workbench/Console|Console]]: everything your space logs, plus a [[Space Lua]] REPL.
* [[Workbench/Scripts|Scripts]]: every `space-lua` block in your space, and how loading it went.
* [[Workbench/Styles|Styles]]: every `space-style` block in your space, and whether the browser could make sense of it.
* [[Workbench/Libraries|Libraries]]: install, update and remove [[Library|libraries]] and [[Repository|repositories]], and check what has an update.
* [[Workbench/Health|Health]]: problems in your space, such as broken links, failed scripts, merge conflicts and (on demand) lint errors.
