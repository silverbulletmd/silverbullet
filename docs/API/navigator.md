---
tags: api/space-lua
references:
- client/navigator/navigator.ts
---
The `navigator` API defines and opens [[Feature/Navigator]] views: filterable list or tree panels, shown as a modal or as a sidebar, over any collection of objects your Lua returns.

## navigator.define(spec)
`navigator.define(spec)`

Registers a view, and optionally a [[Concept/Command]] that opens it. `name`, `source` and `onSelect` are required; everything else is optional. Re-defining a view under the same `name` replaces it -- but a name already claimed by a built-in view (`std.pages`, `std.tags`, `std.anchors`, `std.commands`, `std.spaceTree`) is reserved and cannot be redefined: `navigator.define` throws instead. `std.toc` (the outline) is *not* one of these any more -- it's itself a `navigator.define` call in the std library, kept under its historical name for dock/width continuity. To change what a built-in-bound command opens, define your own view under your own name and bind your own [[Concept/Command]] (or key) to it, rather than trying to redefine the built-in's name.

### Identity and chrome
* `name`: (globally) unique identifier for the navigator view; reserved names (the built-ins above, and anything starting with `__pick:`) throw at definition time.
* `title`: panel title.
* `label`: a short verb shown where the title goes (`"Open"`, `"Run"`), for picker chrome.
* `placeholder`: the filter input’s placeholder, naming what is being picked.

### Command
* `command`: registers a command that opens this view.
* `key` / `mac`: key bindings; both require `command`.
* `menu` / `menuMac` / `menuWindows` / `menuLinux`: native-menu placement (SilverBullet+ only).
* `hide`: keep the command out of the command palette.

### Position target
Where the view opens is configured via:

* `dock`: `"modal"` (default), `"lhs"` or `"rhs"`.
* `openOnStart`: open the (sidebar) view at every boot regardless of what was remembered, whether or not it was open last time. Rejected on a modal view, which has nowhere to stay open.

Whichever sidebar views are open when a client shuts down are opened again on its next boot, per side. Closing a sidebar is what un-remembers it.

On narrow screens (below 600px) a sidebar dock becomes a full-width drawer over the editor, spanning everything below the top bar. It dismisses on selection like the modal, and has no resize handle. Boot restore and `openOnStart` are skipped there entirely.

### Data source
* `source`: takes `{ phrase, segment }` as an argument and returns the objects to show.
* `search`: `"client"` (default: the source runs once, the panel ranks) or `"source"` (typing re-invokes the source, whose order wins).
* `refreshOn`: event names that re-run the source. Defaults to none. For a view over the space (a page/document listing, a tree), the recommended set is `{ "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" }` -- the built-in pickers and the space tree all declare it explicitly.
* `refreshOnOpen`: re-run the source every time the view is activated in a panel that is already open, for a view whose rows are a fact about *now*.
* `followEditor`: a sidebar view tracks the page you navigate to.

#### Search modes
`source` is handed a context table: `{ phrase = <what is typed>, segment = <active segment's label, or nil> }`. What it does with it is what `search` decides.

`search = "client"` (the default) runs the source once per load, hands it the state at that moment, and does everything else in the panel: the phrase ranks fuzzily and the segments subset by `where`, both without leaving the panel. Sources that ignore `ctx` entirely — the common case — are exactly this mode.

`search = "source"` makes the source the search. Typing or switching segments re-invokes it (debounced, and a response overtaken by a newer request is dropped), and the order it returns is the order shown — the panel does no ranking of its own, and `where` predicates are never consulted. Use it when the data set is too large to hand over whole, or when something else already does the searching.

#### Re-opening a view
A view's rows are loaded once and then kept, refreshed by its `refreshOn` events.

Opening a panel that was closed re-runs `source` once, since a closed panel hears none of its `refreshOn` events. Everything else reuses what the view already has: re-activating the view a panel is already showing, or hopping to a sibling it has visited before. That is right for a tree of the space, and wrong for anything whose order or membership is a fact about *now*: recency, the page you are currently on, which commands the cursor's context allows. `refreshOnOpen = true` re-runs `source` for those activations too.

### Filter
`filter` is a table of everything about how the phrase matches:

* `fields`: `{ <field> = <weight> }`, what the phrase is fuzzy-matched against. See [[API/search]] for the same shape.
* `pathCompletion`: `Space` completes the current folder, `Alt-Space` the next path segment.
* `hashtagFilter`: read a `#tag` in the phrase as a tag filter.
* `stripPrefix`: a leading character dropped before ranking, for rows named without a sigil people type.

`filter = false` turns the phrase filter off entirely: the input is hidden, and printable keys do nothing. Everything else about the panel's keyboard contract is unchanged — the arrows, `Enter`, `Escape`, `Tab` and a view's own `keymap` all keep working. For views whose rows are short snippets and whose scoping happens elsewhere (a `dropdown`, `segments`).

#### Path completion
`filter.pathCompletion = true` adds two completion features:

* **`Space` on an empty phrase** inserts the folder the editor is currently in (or, at the root, the current page's own name as a folder), so a picker opened from `Projects/Alpha` starts scoped to `Projects/` with one keystroke.
* **`Alt-Space`** extends the phrase by one more segment of the best-matching row, so a deep hierarchy is walked rather than typed.

#### Hashtag filtering
`filter.hashtagFilter = true` reads a `#tag` in the phrase as a filter rather than as something to fuzzy-match a name against. `#meet` keeps the rows whose `tags` field contains a tag *starting* with `meet`, and the `#meet` itself is taken out of the phrase before ranking.

### Presentation
`presentation` is a table of:

* `mode`: `"list"` (default) or `"tree"`.
* `hierarchy`: `{ field = <string>, separator = <string> }` (a table of named keys, not a positional pair), defaults to `{ field = "name", separator = "/" }`. Tree only. The field's value is the row's path and thus its identity: it must be unique per row — rows sharing a path collapse onto a single tree node.
* `foldersFirst`: group folders above everything else. Tree only. Default on.
* `expandAll`: every folder starts open, and what is remembered is what you *closed*. Tree only.
* `expansionScope`: `"view"` (default, persisted per view) or `"page"` (kept only while you are on the page, for a tree of the current page's own content). Tree only.
* `limit`: (default 200) rows rendered before the `N more matches` footer.
* `createIcon`: the create row's icon (see [[#Row icons]] for the accepted forms), resolved once for the view since its "object" is whatever is being typed.
* `row`: `{ primary, label, description, decorations, cssClass, icon }`. `primary`/`label`/`description`/`cssClass` are each either a field name or a function of the object; `cssClass` adds classes to the row element itself; `icon` is described under [[#Row icons]].

#### Row decorations
`presentation.row.decorations` puts chips on a row. It is a function of the object returning a **list** of chips — a single chip has to be wrapped in a list of one — or `nil` for an undecorated row.

```lua
presentation = {
  row = {
    decorations = function(obj)
      return { { text = obj.text, cssClass = "sb-hashtag", position = "right" } }
    end,
  },
}
```

A chip is `{ text?, icon?, cssClass?, position?, title? }`:

* `text`: the chip's label.
* `icon`: see [[#Row icons]] for the three accepted forms.
* `cssClass`: yours to pick — `"sb-hashtag"` gets SilverBullet’s own tag pill, and `"sb-nav-chip-hint"` the **hint slot**: right-aligned at the row's edge.
* `position`: `"left"` or `"right"` (default), which end of the row the chip sits at.
* `title`: native tooltip, for a chip whose text is deliberately imprecise.

#### Row icons
`presentation.row.icon` puts an icon at the start of every row — a string, or a function of the object returning one; `nil` (or a function returning `nil`) means no icon. A string is one of three forms:

* a bare [Feather](https://feathericons.com) name — `"lock"`
* a namespaced name — `"feather:lock"`, equivalent to the bare form; the prefix is how future icon sets (`"lucide:lock"`, say) will arrive
* literal SVG markup — any string starting with `<svg` (after trimming leading whitespace) is used as-is

`actions[i].icon`, `segments[i].icon` and `presentation.createIcon` take the same three forms.

```lua
presentation = {
  mode = "tree",
  row = {
    icon = function(obj)
      if obj.isFolder then return "folder" else return "file-text" end
    end,
  },
}
```

### Callbacks and interaction modes
* `onSelect`: `(obj, ctx)` for the picked row. **Required.** Returning `false` keeps the panel open.
* `onCreate`: takes the typed phrase, for the create row. The create row appears iff `onCreate` is defined.
* `onMove`:`(obj, newName)`, when defined makes a tree drag-and-drop capable.
* `keymap`: key name to function map of the selected row’s object. Navigation keys are rejected.
* `actions`: per-row buttons.
* `segments`: segmented control entries.
* `dropdown`: an in-panel select subsetting the rows by a value.
* `prefixViews`: single character mappings to the name of a sibling view it routes to.

The create row only appears while the phrase is non-empty and matches no row exactly. Pick it with `Enter` while it is selected, or with `Shift-Enter` from anywhere in the list.

#### onSelect
`onSelect(obj, ctx)` is handed the object of the row that was picked, and a context table with one field:

* `ctx.from`: the view a [[#Prefix routing|prefix]] arrived from, if this view was reached that way, the view to hand the slot back to.

Returning `false` **keeps the panel open**. A modal otherwise dismisses itself the moment a row is picked, which would shut the panel an `onSelect` that re-opened the navigator itself just put up.

A common body, for a view whose rows are pages or page-like objects:

```lua
onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
```

#### Keymaps
`keymap` gives a view its own key actions on top of the built-in navigation:

```lua
keymap = {
  [" "] = function(obj)
    editor.navigate(obj.ref or obj.name)
  end,
}
```

Key names are the browser's `KeyboardEvent.key` values. A key fires only when there is something to act on: a pure folder row and the create row have no object of their own, so they don’t trigger it.

Printable keys (a single character, like `" "` or `"r"`) only act while you are **navigating** — that is, after an arrow/Page/Home/End keypress moved the selection.

#### Row actions
`actions` gives a view per-row buttons, shown at the right edge of a row while the pointer is over it and on the selected row.

```lua
actions = {
  { icon = "edit-3", label = "Rename", requireMode = "rw",
    run = function(obj) ... end },
  { icon = "trash-2", label = "Delete", requireMode = "rw",
    run = function(obj)
      if not editor.confirm("Delete " .. obj.name .. "?") then return end
      ...
    end },
  { icon = "plus", label = "New page here", requireMode = "rw",
    when = function(obj) return obj.isFolder end,
    run = function(obj) ... end },
}
```

* `label`: tooltip and accessible name.
* `run`: function invoked with the row's object. Confirm inside it (`editor.confirm(...)`, as above) if the action needs it -- there is no declarative `confirm` key.
* `icon`: see [[#Row icons]] for the three accepted forms.
* `when` (optional): predicate deciding whether the action applies to an object.
* `requireMode` (optional): `"rw"` hides the action while the client is in read-only mode.

In a tree, actions appear on folder rows too: a folder reaches `run` as `{ name = <path>, isFolder = true }`, and a page that also has children carries both its own fields and `isFolder`, the same object `onMove` gets.

#### Segments
`segments` puts a segmented control under the phrase input: named subsets of the view’s own rows, switchable without re-running the source.

```lua
segments = {
  { label = "All", icon = "layers", default = true },
  { label = "Pages", icon = "file-text",
    where = function(obj) return obj.tag == "page" end },
  { label = "Documents", icon = "file",
    where = function(obj) return obj.tag == "document" end },
}
```

* `label`: the segment's text, its tooltip, its accessible name, and the key the active segment is persisted under — so labels must be unique.
* `where`: predicate callback function deciding whether an object belongs to this segment.
* `icon`: see [[#Row icons]] for the three accepted forms.
* `default`: the segment the view starts on, when omitted: the first.
* `prefix`: a single character that activates this segment when it is the first thing typed into an empty phrase (see [[#Prefix routing]]).
* `placeholder` (optional): the filter input's placeholder while this segment is active, overriding the view’s.

Filtering composes with the phrase: the segment subsets the rows, then the phrase ranks what is left. In a tree the subset is rebuilt into a tree, so the folders its rows live under come back on their own.

The active segment is remembered per view and restored when it is reopened.

`Tab` is claimed by the panel whether or not it has segments: focus lives in the filter input for the panel’s whole life, and letting `Tab` walk the browser's focus order would strand the user somewhere they cannot type. Pointer interactions hold to the same contract: clicking a row, a folder chevron, a segment, an action or the panel’s own background never moves focus off the filter input (or hands it straight back), so the panel’s keys keep working after any click — the one exception is a drag canceled mid-gesture (Escape, or a drop somewhere invalid), which can leave focus stranded until the next interaction.

#### Dropdown
`dropdown` puts a select control in the panel header: a subset of the view’s rows picked from a list of values, for value sets too large or too dynamic for segments.

```lua
dropdown = {
  placeholder = "Recipient",
  options = function()
    return {
      { label = "PeteSmith", value = "People/Pete Smith" },
      { label = "AnnaJones", value = "People/Anna Jones" },
    }
  end,
  key = function(obj) return obj.target end,
}
```

* `options`: a function returning a list of `{ label, value }` entries, or such a list directly. The function is re-evaluated **every time the view’s source loads or refreshes** (the `refreshOn`/`refreshOnOpen` cycle), not once at define time, so a dynamic option set stays fresh.
* `key`: callback returning the option value an object belongs under. Called **once per row**, and its result compared to each option by equality.
* `where`: predicate deciding whether an object belongs under the selected `value`. The general form, for membership that is not a plain equality — a row under several values, or a range. Called **once per row per option**, so a view with many rows and many options pays `rows × options` calls on every refresh; prefer `key` whenever the predicate is really `obj.field == value`.
* `placeholder` (optional): what the select reads as while nothing is selected -- and, absent `allLabel`, the built-in "All" option's label too.
* `allLabel` (optional): label of the built-in "All" option, overriding `placeholder` for that one entry. Defaults to "All" if not given.
* `default` (optional): the value to open on — a string, or a function returning one, re-evaluated on the same cycle as `options`. Ignored when it is not among the options that cycle resolved, and overridden by a value the user last picked.

A dropdown declares `key` or `where` — one of the two; `key` wins if both are given.

The first entry is always a built-in **All** — no filtering — and it is what the view opens on unless a `default` says otherwise. Filtering composes with everything else the panel does: the active segment (if the view has both) subsets the rows, the dropdown selection subsets them further, and the phrase ranks what is left.

The active selection is remembered per view and restored when it is reopened, like the active segment — falling back to `default`, and then to All, when it was never touched, or when the remembered value is no longer among the options.

The select is a pointer affordance: picking a value hands focus straight back to the filter input, and `Tab` stays the panel’s (see above).

#### Prefix routing
A character typed as the *first* thing into an empty phrase can mean something other than itself. Two mechanisms share that gesture, and the difference between them is what they reach:

**A segment prefix** (`segments[i].prefix`) narrows to a subset of the rows this view already has — same source, same presentation, one fewer thing on screen:

```lua
segments = {
  { label = "Pages", default = true },
  { label = "Meta", prefix = "^", where = isMetaPage },
}
```

**A prefix view** (`prefixViews`) hands the slot to a different view entirely — its own source, its own segments, its own actions:

```lua
prefixViews = { ["$"] = "std.anchors", ["#"] = "std.tags" },
```

#### Drag and drop
A tree view with `onMove` lets you drag rows to a new place in the hierarchy. Drop targets are folders and the tree’s root area. Hovering a collapsed folder for some time opens it. The drop renames the dragged item to `<target folder>/<last segment>` and calls `onMove(obj, newName)`. Dragging a folder moves everything under it. A name that already exists in the tree aborts the drop with an error notification. Folder rows reach `onMove` with an added `isFolder = true`; a page that also has children carries both `isFolder` and its own fields. Desktop only.

## navigator.pick(spec)
`navigator.pick(spec)`

A one-shot modal picker: opens, suspends the calling script, and returns the selected row’s object — or `nil` if it was dismissed (Escape, backdrop) or superseded by a newer navigator open before anything was picked.

```lua
local task = navigator.pick {
  title = "Pick a task",
  source = function() return query [[from index.tag "task" where not _.done]] end,
  presentation = { row = { primary = "name", description = "page" } },
}
if task then editor.navigate(task.ref) end
```

It’s the successor to `editor.filterBox` for a rich, filterable, optionally-segmented or tree-shaped picker inline in a script.

**`onSelect`** is optional, same signature as `navigator.define`‘s (`(obj, ctx)`):
* Absent: picking a row resolves `navigator.pick` with that row’s `obj` and closes the panel.
* Present: it runs, returning `false` keeps the panel open (unchanged semantics — the handler has taken the slot over itself), anything else resolves `navigator.pick` with the selected `obj` regardless of what `onSelect` returned.

## navigator.open(name, opts?)
`navigator.open(name, opts?)`

Opens the view registered under `name`, and returns whether a panel came up. Opening a view whose dock is already visible re-focuses its filter input (unless `focus = false`).

**Parameters:**

* `name`: the view's `name`.
* `opts?`:
  * `segment`: the label of the segment to open on, overriding both the view's `default` segment and the one it remembers
  * `phrase`: the phrase to open with.
  * `dropdown`: the [[#Dropdown|dropdown]] value to open selected, overriding the remembered one for this open only — it is never persisted, so the next open without one restores the remembered (hand-picked) selection or All. A value not (yet) among the loaded options filters as the built-in "All" until a refresh brings its option in.
  * `focus`: `false` opens the panel without taking keyboard focus — the editor keeps it. Only the focus grab is skipped: the rows still refresh and the phrase/selection reset like any other open (unlike a boot restore, which is fully passive). Such an open also never toggles an already-focused panel closed.

