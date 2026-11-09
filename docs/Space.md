---
description: "A folder containing your Markdown pages, documents and configuration."
tags: glossary
references:
- client/spaces/space_primitives.ts
- server-common/src/space.rs
---
A _space_ is SilverBullet terminology for a workspace, or project, or instance. [Obsidian](https://obsidian.md/) calls this a vault, [LogSeq](https://logseq.com/) calls it a graph. You may think of it as a [[Folder]] or a directory — because in practical terms, that’s all it is.

Feel free to back up or manipulate your space’s folder and its files with whatever tool you like — you don’t have to use SilverBullet exclusively. You may want to turn your space’s folder into a git repository, for instance, and do version control and back-ups that way.

A space consists of
* [[Folder|Folders]]
* [[Page|Pages]] and [[Tool Page|Tool Pages]]
* [[Document|Documents]]

# Who a space is for
A space belongs to whoever runs the server it lives on. Often that is a single person — but nothing about a space assumes it. A space may just as well be held by a handful of people, each with their own account and [[Dashboard#Access|access level]], together with scripts writing to the same files.

# Folder layout
Every space in SilverBullet at the very least has an index page (by default named `index.md`). Once you configure something, it also has a configuration page, [[^Library/Config]] (the file `Library/Config.md`), so most spaces have a `Library/` folder. [[Library|Libraries]] you install go there too. Spaces from before this change had a root `CONFIG.md`; the server moves it to `Library/Config.md` the first time it starts.
