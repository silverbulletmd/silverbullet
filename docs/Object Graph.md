#maturity/experimental

An interactive object-graph explorer visualizes [[Object|objects]] (pages, items, blocks) and the typed [[Object/relation|relations]] between them — letting you navigate your space by structure rather than by name.

# Commands
* ${widgets.commandButton("Graph: Explore")} (`Ctrl/Cmd-Shift-G`): Opens an exploratory graph anchored on the currently open page. Its 1-hop neighborhood is loaded immediately, expand more by clicking ghost nodes.
* ${widgets.commandButton("Graph: Global Page Map")}: Loads every content page in the space and the `mention` relations between them, all pre-expanded. Useful for a bird's-eye view; toggle other relation labels on from the sidebar to bring in further edges without a refetch.

# Interacting with the graph
* **Click a translucent (ghost) node** to expand its 1-hop neighborhood into the graph.
* **Click an expanded (solid) node** to select it — its attributes appear in the sidebar’s Object section.
* **Double-click any node or edge** to navigate to its definition.
* **Hover an edge** to see its label and snippet.
* **Drag** a node to pin it, the layout reflows around it.
* **Hover** a node to dim everything outside its neighborhood.
* **Scroll / pinch** to zoom; drag empty space to pan.
* **`Esc`** or the `×` button closes the modal.

# Panels
* **Header** — buttons for **Expand** (open every visible ghost in one batch), **Collapse** (reset the explored set to the selected object + its 1-hop), and a **Hide labels** checkbox to suppress edge labels on dense graphs.
* **Sidebar**
  * **Root tags** — toggle visibility by structural object kind.
  * **Tags** — toggle visibility by user [[Tag]]. Untagged objects share an `(untagged)` bucket.
  * **Relations** — toggle [[Object/relation|relation]] labels (`mention`, `co-mention`, custom relation types e.g. `spouse`, `team`). `co-mention` is hidden by default in Explore mode; only `mention` is visible by default in Global Page Map mode.
  * **Object** — the selected node's full indexed attributes rendered as YAML. Click the title to navigate to the object. The `×` button (or `Delete` / `Backspace` while the node is selected) removes the node from the graph.

  Each filter section has `all` / `none` shortcuts, a search box when the list is long, and shows counts from the current graph.

# Visual conventions
* **Solid circles** — expanded nodes (their 1-hop neighborhood is loaded).
* **Translucent circles** — ghost nodes, click to expand.
* **Dashed outline** — dangling refs (referenced by some relation but not yet indexed — see [[Aspiring Pages]]).
* **Color** is driven by the node’s primary user tag, auto-derived from the tag name. Untagged nodes use a neutral gray.
* **Edge labels** are the relation `kind` (a reserved value like `mention`, or a user predicate like `spouse`), drawn along the edge. Directed edges carry an arrowhead at the target; relations that connect the same pair in both directions get arrows at both ends; collapsed `co-mention` pairs are rendered undirected.

The graph is powered entirely by the [[Object/relation]] index.