---
description: The top-level folder of Markdown files, assets, and configuration that SilverBullet serves.
tags: glossary
references:
- client/spaces/space_primitives.ts
- server-common/src/space.rs
---
A _space_ is SilverBullet terminology for a workspace, or project, or instance. [Obsidian](https://obsidian.md/) calls this a vault, [LogSeq](https://logseq.com/) calls it a graph. You may think of it as a [[Concepts/Folder]] or a directory — because in practical terms, that’s all it is.

Feel free to back up or manipulate your space’s folder and its files with whatever tool you like — you don’t have to use SilverBullet exclusively. You may want to turn your space’s folder into a git repository, for instance, and do version control and back-ups that way.

A space consists of
* [[Concepts/Folder]]
* [[Concepts/Page]] and [[Concepts/Meta Page]]
* [[Concepts/Document]]

# Who a space is for
A space belongs to whoever runs the server it lives on. Often that is a single person — but nothing about a space assumes it. A space may just as well be held by a handful of people, each with their own account and [[Features/Space Manager#Access|access level]], together with the scripts and agents writing to the same files.

# Folder layout
Every space in SilverBullet at the very least has an index page (by default named `index.md`) and a [[CONFIG]] page (named `CONFIG.md`). If you use [[Concepts/Library]], you will likely have a `Library/` folder as well.
