---
description: "A filterable navigation tree of pages, documents and tool pages."
---
The _Space Tree_ offers an alternative, more traditional approach to navigate your space. Launched via ${widgets.commandButton("Navigate: Tree")}, it provides a persistent tree  on the left (by default) that can be filtered based on name, and offers various segments:

* All: showing both [[Page|Pages]] and [[Document|Documents]]
* Pages: Showing just (content) pages
* Documents: Showing just [[Document|Documents]]
* Tool Pages: Showing just [[Tool Page|tool pages]]

# Reordering
New pages, and pages you have not arranged yet, appear at the top of their folder in alphabetical order. Arranged pages follow in the order you saved.

To arrange items, drag a row onto the top or bottom edge of another row: a line shows where it will land. Dropping in the middle of a folder still moves the item inside it, and dropping on the bottom edge of an expanded folder makes it that folder's first item. Dropping on an edge in a different folder moves the item there and places it. Only the folder you drop into gets a saved order; its parent folders stay where they were.

A drop saves the whole current order of that folder, so pages you add to it later appear at its top.

Dragging is off while a filter is active, in read-only spaces and on touch devices; use **Move up** and **Move down** from the row menu instead (these also work from the keyboard). **Reset order** in a folder's menu goes back to alphabetical. Move up, Move down and Reset order are not available in read-only spaces. To reset the order of the top level, edit `Library/Space Tree Structure`.

## Where the order is stored
The order lives in the page `Library/Space Tree Structure`, a nested list of wiki links to full page names (folders without a page appear as plain text). You can edit it by hand. Renaming a page inside SilverBullet keeps its place, because the link is rewritten; renaming outside SilverBullet does not.

# Row menu
Each row has a ⋯ menu with its actions: **New page here** (folders), **Rename**, **Delete**, **Move up**, **Move down** and **Reset order** (folders with a saved order). Open it with the ⋯ button, or press the keyboard menu key or Shift-F10 on the selected row. Right-clicking keeps your browser's own context menu. The same ⋯ menu is used for row actions in every [[View]].
