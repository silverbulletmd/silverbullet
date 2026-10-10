---
description: A backlink reference showing everywhere a page is linked from.
tags: glossary
references:
- plugs/index/relation.ts
---
Linked mentions (also known as backlinks) show all pages that contain a [[Link|link]] to the current page. They appear as a “Linked Mentions” section that (by default) is docked at the bottom of every page that has incoming links.

# How?
SilverBullet's [[Object Index]] tracks all links between pages. The Linked Mentions view queries this index to find pages that link _to_ the page you're currently viewing, then displays them with a snippet of the surrounding context. `${...}` expressions in a snippet are shown as source, not evaluated.

This allows for easy navigation and helps you discover connections between concepts through these bi-directional links.

# Why?
In a traditional notes app, links are one-directional: page _A_ links to page _B_, but page _B_ has no idea. With linked mentions, every link becomes bi-directional. This means:

* You can give a person, project, or concept its own page, and the linked mentions section will automatically collect every reference to it
* You discover unexpected connections between ideas
* Your knowledge graph builds itself as you write
