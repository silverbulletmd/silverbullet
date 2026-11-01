---
description: "Practical conventions for page names, links, tags and live collections."
tags: guide
---
Choose conventions that make your notes easier to write and find, and add structure when it solves a problem you actually have.

# Flat name space
Starting with top-level pages such as `Photo Walk` and `Reading List` keeps the initial filing decision small. [[Link|Links]] connect related subjects, and tags can place the same page in several categories. You can use [[Folder|folders]] when a hierarchy is useful: `Trips/Photo Walk` appears under `Trips/` in the [[File Tree]]. Run `Navigate: Tree` to open it.

Common folder conventions include `Inbox/` for quick notes, `Journal/` for dated entries and `Library/` for installed [[Library|libraries and customizations]]. These are useful patterns, not prerequisites for taking notes. [[Guide/Find Pages]] compares the navigation options.

# Frontmatter and tags
Use a standalone hashtag paragraph for a simple page category. When you need more attributes, put them together in [[Frontmatter]] at the beginning of the page:

```markdown
---
tags: outing photography
status: planned
date: "2026-06-14"
---
A plan for a morning photo walk.
```

If every page of a kind uses the same tag, you can query them together even when their other fields differ. A tag on a task categorizes that task; it does not tag the page. [[Guide/Organize with Tags and Attributes]] teaches those scopes, and [[Markdown/Hashtags]] and [[Attribute]] retain the precise rules.

# Page conventions
* Use readable titles such as `Reading List`. [[Names]] lists naming constraints.
* Let the filename supply the page title; start the body with a useful summary rather than repeating it as an H1.
* Make the opening paragraph meaningful by itself; previews and catalogs can quote it.
* Write wiki links from the space root: `[[Trips/Photo Walk]]`. The path does not depend on where the linking page lives. See [[Link]].
* Keep the source Markdown readable outside SilverBullet. Explain what a computed collection means in ordinary prose too.

# Querying your space
Begin in [[Workbench/Query]] to inspect records and build filters. [[Guide/Build Your First Query]] teaches this without handwritten syntax. When you adapt the source:

* Prefer `index.contentPages()` for ordinary page lists; it excludes [[Meta Page|meta pages]] such as library and configuration pages. Use `index.pages()` when you want those included.
* Choose the right kind: `index.tasks("packing")` reads packing-tagged tasks; `index.contentPages("packing")` reads packing-tagged pages.
* Allow asynchronous indexing to catch up after an edit. Live results reevaluate when their dependencies change; they can briefly lag the Markdown. See [[Guide/When Results Update]].
* Use the [[Guide/Aggregator Pages|aggregator pattern]] for collections that would otherwise need a second membership list.
* Inspect [[Aspiring Pages]] to find forward references that have not acquired content yet; not every such link is a mistake.

[[Object Index]] owns the index helpers and user-visible behavior. [[Guide/Query Recipes]] offers small examples you can copy and adapt.

# Authoring Space Lua
Reusable `space-lua` definitions are optional. Use [[Workbench/Console]] for small experiments before installing space-wide code. When you change a definition, run `System: Reload`, then inspect **Scripts** and **Console** for errors. Reload completing does not establish that all scripts loaded correctly.

`System: Reload` calls [[API/system#system.reboot]], which incorporates external changes to the open page and waits for indexing. Call it directly when a script needs that same readiness behavior. Put index-affecting tag definitions in [[CONFIG]], and reindex existing content after changing a transform. Ordinary Markdown edits do not need this reload loop. [[Space Lua]] and [[Guide/When Results Update]] explain the distinct lifecycles.
