---
tags: maturity/experimental
references:
- plugs/object-graph/*
---
An interactive object-graph explorer visualizes [[Object|objects]] (pages, items, blocks) and the typed [[Tag/relation|relations]] between them — letting you navigate your space by structure rather than by name.

# Opening the graph
The graph is a view (`std.graph`) with two tabs:

* **Local**: a graph around the open page. Its direct relations are loaded straight away; add more by clicking ghost nodes.
* **Global**: every content page in the space and the `mention` relations between them, all expanded. Useful for a bird's-eye view; turn other relations on in the filters to bring in further edges without loading anything again.

These commands open it:

* ${widgets.commandButton("Graph: Explore")} (`Ctrl/Cmd-Shift-G`): opens the graph on its Local tab.
* ${widgets.commandButton("Graph: Global Page Map")}: opens the graph on its Global tab.

The graph opens in a large window over the editor. Its dock menu moves it to the left or right sidebar or the bottom panel instead, and it stays there. Docked, the local graph follows the page you open in the editor, and opening an object from the graph leaves it open. To make a sidebar the default for a space, set `view.defaults` (see [[View]]):

```lua
config.set("view.defaults", {
  ["std.graph"] = { dock = "rhs" },
})
```

# Interacting with the graph
* **Click a ghost node** (a tinted ring) to add its direct relations to the graph.
* **Click an expanded (solid) node** to select it: its fields appear below the filters.
* **Double-click any node or edge** to open it in the editor.
* **Hover an edge** to see its relations and the text they come from.
* **Drag** a node to pin it; the layout reflows around it.
* **Hover** a node to dim everything outside its neighborhood.
* **Scroll / pinch** to zoom, drag empty space to pan, or use the zoom and fit buttons in the corner. The arrow keys pan too.
* **`Delete` / `Backspace`** removes the selected node from the graph.
* **`Esc`** closes the graph window, or returns to the editor from a docked graph.

# The toolbar
* **Filters**: shows or hides the filters and the selected object. They start open in the window and closed in a sidebar, where they slide over the graph.
* **Edge labels** and **Orphans**: whether edges are named on the canvas, and whether objects with no visible relation are shown.
* **Focus**: resets the graph to the selected object and its direct relations.
* **Expand all**: follows every shown relation outward until nothing is left to add.

# Filters
* **Tags**: show or hide objects by user [[Tag]]. Untagged objects share an `(untagged)` bucket.
* **Relations**: show or hide [[Tag/relation|relation]] kinds (`mention`, `co-mention`, custom relation types such as `spouse` or `team`). In the Global tab only `mention` is shown at first.
* **Layout**: the forces that lay out the graph, with a reset.

Click a row to hide it (its swatch turns hollow) and again to show it. Each section has *All* / *None* shortcuts, a search box when the list is long, and counts from the current graph. The selected object's section lists its fields, its own first and the index's bookkeeping after; *Open* opens it in the editor.

# Visual conventions
* **Solid circles**: expanded nodes, whose direct relations are loaded.
* **Tinted rings**: ghost nodes; click to add them.
* **Dashed outline**: dangling refs (referenced by some relation but not yet indexed; see [[Aspiring Pages]]).
* **A halo and ring** in the accent color mark the selected node.
* **Color** comes from the node's primary user tag, derived from the tag name. Untagged nodes are neutral. Everything else follows your theme, including dark mode.
* **Edge labels** are the relation `kind` (a reserved value like `mention`, or a user predicate like `spouse`), drawn along the edge. Directed edges carry an arrowhead at the target; relations that connect the same pair in both directions get arrows at both ends; collapsed `co-mention` pairs are rendered undirected.

The graph is powered entirely by the [[Tag/relation]] index.
