---
description: "Practical conventions for page names, links, tags and live collections."
tags: guide
---
Choose conventions that make your pages easier to write and find, and add structure when it solves a problem you actually have.

# Flat name space
Start with top-level pages when you do not need a folder hierarchy. [[Link|Links]] connect related subjects, and tags can place the same page in several categories. You can use [[Folder|folders]] when a hierarchy is useful: `Folder/Page` appears under `Folder/` in the [[File Tree]]. Run `Navigate: Tree` to open it.

Common folder conventions include `Inbox/` for quick notes and `Journal/` for dated entries. These are useful patterns, not prerequisites for taking notes. `Library/` is different: it holds installed [[Library|libraries and customizations]], and `space-lua` and `space-style` blocks only run from pages there (or from [[CONFIG]]). [[Guide/Finding Content]] compares the navigation options.

# Frontmatter and tags
Use the visual [[Frontmatter]] editor to add page tags and attributes. Keep attribute names and types consistent across pages you want to query together. A standalone hashtag paragraph also tags the page.

If every page of a kind uses the same tag, you can query them together even when their other fields differ. A tag on a task categorizes that task. It does not tag the page. [[Guide/Add Structure and Query]] introduces page tags and attributes, and [[Markdown/Hashtags]] and [[Attribute]] retain the precise rules.

# Page conventions
* Use readable, descriptive titles. [[Names]] lists naming constraints.
* Let the filename supply the page title. Start the body with a useful summary rather than repeating it as an H1.
* Make the opening paragraph meaningful by itself. Previews and catalogs can quote it.
* Write wiki links from the space root: `[[Folder/Page]]`. The path does not depend on where the linking page lives. See [[Link]].
* Keep the source Markdown readable outside SilverBullet. Explain what a computed collection means in ordinary prose too.

# Querying your space
Begin in [[Workbench/Data]] to inspect records and build filters. [[Guide/Add Structure and Query]] teaches this without handwritten syntax. When you adapt the source:

* Prefer `index.contentPages()` for ordinary page lists. It excludes [[Tool Page|tool pages]] such as library and configuration pages. Use `index.pages()` when you want those included.
* Choose the right kind: `index.tasks()` reads tasks. `index.contentPages()` reads pages. Both can be narrowed to a tag.
* Use the [[Guide/Aggregator Pages|aggregator pattern]] for collections that would otherwise need a second membership list.
* Inspect [[Aspiring Pages]] to find forward references that have not acquired content yet. Not every such link is a mistake.

[[Object Index]] owns the index helpers and user-visible behavior.

# Authoring Space Lua
Reusable `space-lua` definitions are optional. Use [[Workbench/Console]] for small experiments before installing space-wide code on a page under `Library/`. When you change a definition, run `System: Reload`, then inspect **Scripts** and **Console** for errors. Reload completing does not establish that all scripts loaded correctly.

`System: Reload` calls [[API/system#system.reboot]], which incorporates external changes to the open page and waits for indexing. Call it directly when a script needs that same readiness behavior. Put index-affecting tag definitions in [[CONFIG]], and reindex existing content after changing a transform. Ordinary Markdown edits do not need this reload loop. [[Space Lua]] and [[Guide/When Results Update]] explain the distinct lifecycles.
