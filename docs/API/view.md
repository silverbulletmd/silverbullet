---
tags: api/space-lua maturity/experimental
references:
- client/navigator/navigator.ts
---
The `view` API creates reusable lists, trees, and Markdown views. They can be rendered as dockable panels, or inline using [[Space Lua#Expressions]].

## view.new(spec)
Creates a view value with either `source` (rows) or `content` (Markdown). The options below belong to this value, panel-only options take effect when it is registered with `view.define`.

### source
* `source(ctx)`: returns the objects to display. Mutually exclusive with `content`.
* `search`: `"client"` (default) or `"source"`; see below.
* `refreshOn`: events that rerun the source; defaults to none.

#### The source context
`source` receives `{ phrase, segment, dock }`: the filter text, active segment label (or `nil`), and resolved rendering location. `content` receives `phrase` and `dock` too. Use `ctx.dock` to vary results by location, inline views receive `"inline"`.

### search
* `"client"`: loads once, filters segments using their `where` predicates, and fuzzy-ranks by the phrase.
* `"source"`: reruns the source when the phrase or segment changes. Requests are debounced and stale responses discarded. The source controls ordering and segment filtering; segment `where` predicates are ignored.

### stateKey
Optional `stateKey` saves tree expansion locally, scoped to the containing page and key. Use distinct keys for independent views on one page. Sharing a key shares saved preferences without live synchronization; renaming the page resets the identity. Without a key, expansion is transient. Focus and selection are not saved.

### content
`content(ctx)` returns Markdown, or `nil` for no content:

```lua
local mentions = view.new {
  refreshOn = { "editor:pageLoaded", "mq:emptyQueue:indexQueue" },
  content = function() return widgets.linkedMentionsMarkdown() end,
}
```

Content uses the markdown renderer for rendering.

Content views have no filter input or row options. Refresh options rerun `content`.

### Panel labels
* `label`: short picker verb, such as `"Open"`, shown in place of the title.
* `placeholder`: filter input placeholder.
* `helpText`: plain text shown below the filter input. A segment can override it with its own `helpText`; an empty string hides it for that segment.

### Filter
Panel filtering options:

* `fields`: field weights, `{ <field> = <weight> }`; see [[API/search]].
* `pathCompletion`: enable folder completion.
* `hashtagFilter`: enable tag-prefix filtering.
* `stripPrefix`: leading character to remove before ranking.

`filter = false` hides the input and disables typing a filter. Navigation keys and custom keymaps still work.

#### Path completion
With `pathCompletion = true`, `Space` on an empty phrase inserts the editor's current folder (or page name at the root). `Alt-Space` completes one path segment from the best match.

#### Hashtag filtering
With `hashtagFilter = true`, `#meet` matches rows with a `tags` entry starting with `meet`. The tag expression is removed before fuzzy ranking.

### Presentation
* `mode`: `"list"` (default) or `"tree"`.
* `hierarchy`: tree path field and separator; defaults to `{ field = "name", separator = "/" }`. Paths must be unique; duplicate paths merge into one node.
* `foldersFirst`: group folders first in trees; defaults to `true`.
* `uploadFiles`: set to `true` to accept files and folders dropped onto a panel tree. The tree paths must be Space folder paths; the user confirms the proposed destination before files are uploaded. Ignored by list and inline views.
* `expandAll`: start all folders open and remember those closed.
* `expansionScope`: for registered trees, `"view"` (default, persisted) or `"page"` (transient while on the page). Inline trees use `stateKey` instead.
* `limit`: maximum displayed rows, default 200. Inline/page-docked trees are uncapped.
* `createIcon`: icon for the panel's create row, resolved once per view.
* `row`: `{ primary, label, description, decorations, cssClass, icon }`. `primary`, `label`, `description`, and `cssClass` accept a field name or function of the object. `primary` supplies list text; `label` overrides a tree's path-segment label.

#### Row descriptions
`presentation.row.description` accepts a string or structured description. Strings appear inline and support Markdown in document lists. Structured descriptions appear below the primary text, with an optional label and up to two excerpt lines:

```lua
presentation = {
  row = {
    description = function(obj)
      return {
        label = "Weekend routes",
        text = "A quiet walking route through pine forest.",
        highlights = { { 8, 15 } },
      }
    end,
  },
}
```

* `text`: required plain text; HTML and Markdown remain literal.
* `label`: optional plain text above the excerpt.
* `highlights`: optional `{ start, end }` pairs, using zero-based UTF-16 offsets with exclusive ends (not Lua byte offsets). The example highlights `walking`.

#### Row decorations
`presentation.row.decorations(obj)` returns a list of chips, or `nil`:

```lua
decorations = function(obj)
  return {{ text = obj.status, cssClass = "sb-hashtag", position = "right" }}
end,
```

Each chip accepts `text`, `icon`, `cssClass`, `position` (`"left"` or default `"right"`), and `title` (tooltip). `sb-hashtag` gives tag-pill styling; `sb-nav-chip-hint` right-aligns a hint at the row's edge.

#### Row icons
`presentation.row.icon` accepts an icon string or a function returning one; `nil` omits it. Supported strings are a [Feather](https://feathericons.com) name (`"lock"`), its namespaced form (`"feather:lock"`), or literal `<svg...>` markup. `actions[i].icon`, `segments[i].icon`, and `presentation.createIcon` use the same forms.

### Callbacks and interaction modes
`onSelect` and `actions` work inline and in panels. Creation, keymaps, segments, dropdowns, prefix routing, and dragging are panel features.

#### onSelect
`onSelect(obj, ctx)` receives the selected object. `ctx.from` identifies a view that routed here through a prefix, when applicable. Returning `false` keeps the panel open.

```lua
onSelect = function(obj) editor.navigate(obj.ref or obj.name) end,
```

Required for flat `view.define` row definitions; optional for `view.new` and `view.pick`. Content views do not use it.

`onCreate(phrase)` adds a create row when the phrase is nonempty and has no exact match. Activate it with `Enter` when selected, or `Shift-Enter` from anywhere in the list.

#### Keymaps
`keymap` maps browser `KeyboardEvent.key` names to callbacks receiving the selected object:

```lua
keymap = {
  [" "] = function(obj) editor.navigate(obj.ref or obj.name) end,
}
```

Reserved navigation keys are rejected. Pure folders and create rows have no object and do not invoke keymaps. Printable keys activate callbacks only after arrow/Page/Home/End navigation. Panel `Tab` and pointer interactions retain filter-input focus.

#### Row actions
`actions` adds row buttons. Inline and page-docked actions appear on hover or focus, and remain visible on touch screens. They run independently of `onSelect`, then refresh the view while preserving tree expansion. Buttons are disabled while an action runs.

```lua
actions = {
  {
    icon = "file-text",
    label = "Open",
    run = function(obj) editor.navigate(obj.name) end,
  },
}
```

* `label`: tooltip and accessible name.
* `run(obj)`: callback; ask for confirmation inside it when needed.
* `icon`: an icon string.
* `when(obj)`: optional visibility predicate.
* `requireMode = "rw"`: hide in read-only mode.

Tree folders reach callbacks as `{ name = <path>, isFolder = true }`; a page with children retains its own fields and gains `isFolder`.

#### Segments
`segments` defines named subsets below the panel filter:

```lua
segments = {
  { label = "All", default = true },
  { label = "Pages", icon = "file-text",
    where = function(obj) return obj.tag == "page" end },
}
```

Each entry accepts a unique `label`, `where(obj)` predicate, optional `icon`, `default` flag (otherwise the first entry), single-character `prefix`, `placeholder` override, and `helpText` override. The selected segment is remembered per view. In client search mode, segment filtering precedes fuzzy ranking.

#### Dropdown
`dropdown` filters rows by a selected value:

```lua
dropdown = {
  placeholder = "Status",
  options = {
    { label = "Active", value = "active" },
    { label = "Paused", value = "paused" },
  },
  key = function(obj) return obj.status end,
}
```

* `options`: list of `{ label, value }` entries, or a function returning one on each source load/refresh.
* `key(obj)`: row's option value; evaluated once per row.
* `where(obj, value)`: alternative predicate, evaluated per row per option. `key` takes precedence if both are set.
* `placeholder`: select placeholder and fallback label for the unfiltered option.
* `allLabel`: override the unfiltered option's label; otherwise uses `placeholder` or `"All"`.
* `default`: initial value, or function evaluated with `options`. Ignored if absent from the available options.

The unfiltered option is always available. Saved selection overrides `default`; if unavailable, selection falls back to `default`, then All. Segment, dropdown, and phrase filters compose.

#### Prefix routing
A prefix at the start of an empty phrase can activate a segment (`segments[i].prefix`) or route to another registered view:

```lua
prefixViews = { ["$"] = "std.anchors", ["#"] = "std.tags" },
```

#### Drag and drop
`onMove(obj, newName)` enables desktop tree dragging. Dropping onto a folder or root calls it with `<target folder>/<last segment>`. Hovering a collapsed folder opens it; duplicate destinations abort with an error. Folder objects include `isFolder = true`. Use `view.moveByRename` to rename pages, documents, and whole folders.


```lua
function projectView()
  return view.new {
    stateKey = "projects",
    source = function()
      return {
        { name = "Projects/Sketchbook" },
        { name = "Projects/Garden journal" },
      }
    end,
    presentation = { mode = "tree" },
    onSelect = function(obj) editor.navigate(obj.name) end,
  }
end
```

Render it in Markdown:

```markdown
${projectView()}
```

Provide exactly one of `source` or `content`, using the options below. `onSelect` is optional; without it, rows are informational and trees still expand.
## view.define(spec)
Registers a view and optionally a [[Command]] to open it. Accepts `name` plus a `view.new` value, or the flat shorthand:

```lua
view.define {
  name = "my.projects",
  command = "Navigate: Projects",
  source = function()
    return {{ name = "Projects/Sketchbook" }}
  end,
  onSelect = function(obj) editor.navigate(obj.name) end,
}
```

The flat row form requires `onSelect`; `view.new` values and content views do not. Reusing a name replaces its definition, except for reserved built-ins (`std.pages`, `std.tags`, `std.anchors`, `std.commands`, `std.spaceTree`, `std.pageHistory`, `std.spaceLog`) and names starting with `__pick:`. `std.toc` is a Lua-defined view and can be replaced.

### Registering a value
```lua
view.define {
  name = "my.projects",
  view = view.new {
    source = function() return {{ name = "Projects/Sketchbook" }} end,
    onSelect = function(obj) editor.navigate(obj.name) end,
  },
  title = "Projects",
  command = "Navigate: Projects",
  dock = "rhs",
}
```

Registration fields (name, title, commands, docking, open settings, and `followEditor`) belong to `view.define`. With `view = ...`, put content options such as `source` and `presentation` inside that value, not alongside it. Docked state uses the registered name, independently of inline `stateKey`.

### Identity and chrome
* `name`: unique registered identifier.
* `title`: panel title.

### Command
* `command`: command that opens the view.
* `key` / `mac`: key bindings; require `command`.
* `menu` / `menuMac` / `menuWindows` / `menuLinux`: native-menu placement (SilverBullet+ only).
* `hide`: hide the command from the command palette.

### Position target
* `dock`: `"modal"` (default), `"lhs"`, `"rhs"`, `"bhs"`, `"page-top"`, or `"page-bottom"`.
* `supportedDocks`: allowed docks; defaults to `{ dock }` and must include `dock`. Invalid docks throw.
* `defaultOpen`: initial open state for page docks; defaults to `false`.
* `openOnStart`: open at every boot regardless of saved state. Only valid for `lhs`, `rhs`, and `bhs`.

| Dock | Behavior |
|---|---|
| `lhs` / `rhs` | Resizable sidebars; remember open state, width, and filter phrase across re-focus. |
| `bhs` | Resizable bottom panel; remembers open state and height. |
| `page-top` / `page-bottom` | Widgets above/below the document, without a filter input. Empty results hide the entire widget. |
| `modal` | Transient picker; clears its phrase on open and dismisses on selection unless `onSelect` returns `false`. |

Each sidebar/bottom slot holds one view. Opening another temporarily displaces the previous view, which returns when the newcomer leaves (one level deep).

Below 600px, sidebars become full-width drawers and dismiss on selection. Sidebars and bottom panels have no resize handle there, and skip boot restoration and `openOnStart`.

In page docks, `Enter`/`Space` activate selectable rows; `ArrowRight`/`ArrowLeft` expand/collapse tree rows. Lists honor `presentation.limit`; trees are uncapped.

#### Persisted state and precedence
Registered views save `dock`, `open`, `collapsed`, `width`, and `height` under `["navigator", name, field]` in the local datastore. Valid saved values override `view.defaults`, which overrides the definition.

```lua
config.set("view.defaults", {
  ["std.toc"] = { dock = "page-top", open = true, width = 320 },
  ["std.spaceTree"] = { open = true },
})
```

* `dock` must be in the view's `supportedDocks`.
* `open` applies to all docks except modal.
* `collapsed` applies only to page docks.
* `width` applies to sidebars; `height` to the bottom panel. Both accept 160–600 pixels.

`Navigate: Reset All Views` clears the client's saved choices so defaults apply again.

#### The dock menu
Views with two or more `supportedDocks` get a dock menu. Choosing a dock moves the view immediately. Closing a view preserves its dock preference; its command reopens it there. Page widgets also have a fold control whose state is remembered.

### Re-opening a view
* `refreshOnOpen`: reload on activation of an already-open panel. Does not apply to inline or page-docked views.
* `followEditor`: a registered sidebar follows the page you navigate to.

Opening a closed panel reloads its source. Reactivating an open panel or revisiting a cached sibling reuses its rows unless `refreshOnOpen = true`. `refreshOn` events refresh loaded views.

## view.pick(spec)
Opens a one-shot modal and suspends the script until selection. Returns the selected object, or `nil` on dismissal or replacement by another view:

```lua
local task = view.pick {
  title = "Pick a task",
  source = function() return query [[from index.tag "task" where not _.done]] end,
  presentation = { row = { primary = "name", description = "page" } },
}
if task then editor.navigate(task.ref) end
```

Optional `onSelect(obj, ctx)` runs before resolving. Returning `false` keeps the picker open; any other return resolves it with the selected object. `content` is not supported.

## view.open(name, opts?)
Opens or focuses a registered view and returns whether it opened. Options:

* `segment`: segment label, overriding the default and remembered segment.
* `phrase`: initial filter text.
* `dropdown`: selected dropdown value for this open only; does not replace saved preferences. An unavailable value leaves rows unfiltered until a refresh supplies it.
* `focus = false`: retain editor focus. The view still refreshes/resets as on a normal open, but never toggles closed from reactivation.

## view.focus(slot?)
Focuses an open view panel's input without changing selection. `slot` is `"modal"`, `"lhs"`, `"rhs"`, or `"bhs"`; omit it to focus any open panel.
