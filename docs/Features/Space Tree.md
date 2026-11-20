---
description: "A filterable navigation tree of pages, documents and tool pages."
---
The _Space Tree_ offers an alternative, more traditional approach to navigate your space. Launched via ${widgets.commandButton("Navigate: Tree")}, it provides a persistent tree  on the left (by default) that can be filtered based on name, and offers various segments:

* All: showing both [[Reference/Concepts/Page|Pages]] and [[Reference/Concepts/Document|Documents]]
* Pages: Showing just (content) pages
* Documents: Showing just [[Reference/Concepts/Document|Documents]]
* Tool Pages: Showing just [[Tool Page|tool pages]]

# Reordering
New pages, and pages you have not arranged yet, appear at the top of their folder in alphabetical order. Arranged pages follow in the order you saved.

To arrange items, drag a row onto the top or bottom edge of another row: a line shows where it will land. Dropping in the middle of a folder still moves the item inside it, and dropping on the bottom edge of an expanded folder makes it that folder's first item. Dropping on an edge in a different folder moves the item there and places it. Only the folder you drop into gets a saved order; its parent folders stay where they were.

A drop saves the whole current order of that folder, so pages you add to it later appear at its top.

Dragging is off while a filter is active, in read-only spaces and on touch devices; use **Move up** and **Move down** from the row menu instead (these also work from the keyboard). **Reset order** in a folder's menu goes back to alphabetical. Move up, Move down and Reset order are not available in read-only spaces. To reset the order of the top level, edit `Library/Space Tree Structure`.

## Where the order is stored
The order lives in the page `Library/Space Tree Structure`, a nested list of names: each entry is a page, document or folder, listed under its folder by its own name, with full paths at the top level. You can edit it by hand:

```markdown
* Getting Started
  * My First Page
* Reference
* Projects/Archive
  * 2025
```

These are plain names, not links, so the order page doesn't show up in Linked Mentions, the graph or queries. Renaming a page, document or folder inside SilverBullet updates the list, so it keeps its place. Renaming outside SilverBullet (in a file manager, or through sync) does not: the entry is dropped the next time the order is saved, and the page goes back to alphabetical order among its siblings. Order pages written by earlier versions, as wiki links, still work, and switch to plain names on the next save.

## Icons and hiding
**Set icon** and **Hide from tree** in a row's ⋯ menu write these for you. An entry in `Library/Space Tree Structure` can carry attributes after it:

* `[icon: book-open]` gives the row that icon (any [[Icons|icon name]]). It works for folders without a page too. A page's own decoration icon (see [[Reference/Theming/Page Decorations]]) wins over it.
* `[hide: true]` hides the entry from the tree, and with a folder, everything under it. Hidden pages still open through links, search and the pickers.

```markdown
* Getting Started [icon: book-open]
* Reference [icon: bookmark]
* Examples [hide: true]
```

Reordering rewrites this page, but keeps every entry's attributes.

# Row menu
Each row has a ⋯ menu with its actions: **New page here** (folders), **Rename**, **Delete**, **Move up**, **Move down**, **Reset order** (folders with a saved order), **Set icon** and **Hide from tree**. Open it with the ⋯ button, or press the keyboard menu key or Shift-F10 on the selected row. Right-clicking keeps your browser's own context menu. The same ⋯ menu is used for row actions in every [[Reference/Concepts/View]].
