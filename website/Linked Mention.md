---
description: A backlink reference showing everywhere a page is linked from.
tags: glossary
---
Linked mentions (also known as backlinks) show all pages that contain a [[Link|link]] to the current page. They appear as a "Linked Mentions" section at the bottom of every page that has incoming links.

# How?
SilverBullet's [[Object Index]] tracks all links between pages. The Linked Mentions widget queries this index to find pages that link _to_ the page you're currently viewing, then displays them with a snippet of the surrounding context.

This allows for easy navigation and helps you discover connections between concepts through these bi-directional links.

# Why?
In a traditional notes app, links are one-directional: page A links to page B, but page B has no idea. With linked mentions, every link becomes bi-directional. This means:

* You can give a person, project, or concept its own page, and the linked mentions section will automatically collect every reference to it
* You discover unexpected connections between ideas
* Your knowledge graph builds itself as you write

# Configuration
You can enable or disable the Linked Mentions widget in [[CONFIG]]:

```lua
-- Disable linked mentions widget
config.set("std.widgets.linkedMentions.enabled", false)
```

# Programmatic access
You can query linked mentions directly using [[Space Lua/Lua Integrated Query]]:

```lua
query[[
  from l = tags.link
  where l.toPage == "Some Page"
  order by l.pageLastModified desc
]]
```

See also: [[Link]], [[Linked Tasks]], [[Object/link]]
