---
tags: api/space-lua maturity/experimental
references:
- client/navigator/navigator.ts
- client/navigator/lua_views.ts
- client/navigator/view_value.ts
---
The `view` API displays objects as lists, trees, or tables, or renders Markdown content. Use `view.new` in a [[Space Lua#Expressions|page expression]], `view.define` to register a dockable view, or `view.pick` when a script needs the user to choose an object.

## view.new(spec)
Creates a view value. The spec must contain exactly one of `source(ctx)`, which returns objects, or `content(ctx)`, which returns Markdown. Render the value in a page expression or pass it to `view.define`.

**Returns:** A view value.

For a minimal inline list that navigates on click:

${view.new {
  source = function()
    return {
      { name = "SilverBullet" },
      { name = "Funding" },
    }
  end,
  onSelect = function(obj) editor.navigate(obj.name) end,
}}

`onSelect` makes rows selectable. To reuse the view, return `view.new { ... }` from a function and call that function in the expression.

### Data and refresh
| Option | Effect |
| --- | --- |
| `source(ctx)` | Returns the objects to display. Each object is passed unchanged to callbacks. |
| `content(ctx)` | Returns Markdown, or `nil` to display nothing. Content views have no rows or filter input. |
| `refreshOn` | List of event names that reload the source or content; defaults to none. |
| `stateKey` | Saves an inline tree's expansion state locally, scoped to the containing page and this key. Without it, expansion is transient. |
| `title` | Adds a panel-style heading to an inline view. A registration can override it for its panel. |
| `label`, `placeholder`, `helpText` | Configure panel text: a short picker verb, filter placeholder, and help below the input. A segment can override the last two. |

`source` receives a table with `phrase`, `segment` and `dock` keys: the current filter phrase, active segment label (or `nil`), and rendering location. `content` receives the same context; an inline view has `dock = "inline"`. The source can use `ctx.dock` to return different objects for a panel and an embedded view.

For Markdown content instead of rows:

```lua
view.new {
  refreshOn = { "editor:pageLoaded" },
  content = function()
    return "## Current page\n\n" .. editor.getCurrentPage()
  end,
}
```

Content views use the Markdown renderer and do not support row options. `stateKey` saves expansion only; focus and selection are not persisted.

### Presentation
`presentation.mode` supports `"list"` (the default(, `"tree"` for hierarchical paths, or `"table"` for columns. A view with `content` does not use a presentation mode.

| `presentation` option | Effect |
| --- | --- |
| `row` | List/tree row display: `primary`, `label`, `description`, `decorations`, `cssClass`, and `icon`. |
| `limit` | Maximum displayed rows; defaults to 200. Inline and page-docked trees are uncapped. |
| `hierarchy` | Tree path field and separator; defaults to `{ field = "name", separator = "/" }`. Duplicate paths merge into one node. |
| `foldersFirst` | Group tree folders first; defaults to `true`. |
| `expandAll` | Start all tree folders open and remember those closed. |
| `expansionScope` | Registered tree expansion scope: `"view"` (default, persisted) or `"page"` (transient while on the page). Inline trees use `stateKey`. |
| `uploadFiles` | Let a panel tree accept dropped files and folders. Tree paths must be Space folder paths; upload asks the user to confirm the destination. |
| `createIcon` | Icon for a panel's create row. |
| `columns` | Explicit table columns; omit to derive them from the source objects. |

`presentation.row.primary` supplies list text; `label` overrides a tree path segment. `primary`, `label`, `description`, and `cssClass` each accept an object attribute name or a function of the object. `row.icon` accepts an icon string or a function returning one. An icon may be a Feather name such as `"lock"`, `"feather:lock"`, or literal `<svg...>` markup; action, segment, and create-row icons use the same forms.

A string `row.description` appears inline and supports Markdown in document lists. For an excerpt below the primary text, return `{ text = "...", label = "...", highlights = { { start, end } } }`. The text and optional label are plain text; highlights use zero-based UTF-16 offsets with exclusive ends. `row.decorations(obj)` returns chips with `text`, `icon`, `cssClass`, `position` (`"left"` or `"right"`), and `title`. The `sb-hashtag` class gives a tag pill; `sb-nav-chip-hint` right-aligns a hint.

### Table columns
`presentation = { mode = "table" }` derives columns from the union of attributes in the loaded objects. It keeps the first object's attribute order and appends new attributes in the order they first appear in later objects. Filtering and `presentation.limit` do not change those columns in client search mode. Source order is also the row order; table headers do not sort rows, so sort the source before returning it if needed.

This inline table needs no column definitions:
${view.new {
  title = "Projects",
  source = function()
    return {
      { name = "Projects/Sketchbook", status = "Active", done = false },
      { name = "Projects/Garden journal", status = "Paused", done = true },
    }
  end,
  presentation = { mode = "table" },
  filter = { inline = true },
}}

For live data, replace the static `source` with a query:
```lua
source = function()
  return query [[
    from p = index.pages("project")
    order by p.name
  ]]
end,
```

Declare `presentation.columns` to choose the displayed attributes, order, labels, or rendering types. A column needs `attribute` or `value(obj)`; a computed column can omit `attribute`. The callback result still passes through the declared type’s renderer.

${view.new {
  title = "Projects",
  source = function()
    return {
      { name = "Projects/Sketchbook", estimate = 8, spent = 3, done = false },
      { name = "Projects/Garden journal", estimate = 5, spent = 5, done = true },
    }
  end,
  presentation = {
    mode = "table",
    columns = {
      { attribute = "name", label = "Project", type = "ref" },
      { attribute = "done", type = "boolean" },
      { label = "Remaining", type = "number",
        value = function(obj) return obj.estimate - obj.spent end },
    },
  },
  filter = { inline = true },
  actions = {
    { icon = "file-text", label = "Open",
      run = function(obj) editor.navigate(obj.name) end },
  },
}}

In each:

| Column option | Effect |
| --- | --- |
| `attribute` | Literal source-object key to display when `value` is absent. |
| `label` | Header text; defaults to the attribute name, or an empty header for a computed column. |
| `value(obj)` | Computes the displayed value from the original object. |
| `type` | Selects a renderer: `ref`, `number`, `boolean`, `url`, `text`, or `markdown`. |

Supported `type`s:
| Type | Rendering |
| --- | --- |
| `ref` | Clickable SilverBullet reference from a bare reference or a complete `[[wiki link]]`; preserves aliases, headers, anchors, and positions. |
| `number` | Locale-formatted, right-aligned finite number; also accepts a nonempty numeric string without locale separators. |
| `boolean` | Disabled checkbox with the standard checkbox styling; accepts booleans and the strings `true` and `false`, ignoring case and surrounding whitespace. |
| `url` | Clickable absolute URL, subject to SilverBullet's URL safety policy. |
| `text` | Literal text, including any Markdown syntax. |
| `markdown` | Rendered Markdown. |

Without a type, strings—including `value(obj)` results—render as Markdown. Numbers and booleans display as text, arrays as comma-separated values, nested objects as compact JSON, and missing values as empty cells. With a type, array elements use that renderer; invalid typed values remain visible as literal text. Tables scroll horizontally when needed.

Without `onSelect`, table rows have no selection styling or row focus stop. Links and actions remain interactive. With `onSelect`, activating a row passes its original object; links and actions do not activate the row. Actions appear in an unlabeled trailing column, on hover or keyboard focus and continuously on touch devices. Running an action refreshes the table. In table panels, `Tab` follows the normal focus order so links and actions are reachable.

### Filtering and search
Panels have a filter input by default. An embedded list, tree, or table gets one only with `filter = { inline = true }`; it appears in the view's heading when `title` is set. Each embedded view keeps its own phrase. `filter = false` hides the input and disables phrase filtering while leaving navigation keys and keymaps available.

| Option | Effect |
| --- | --- |
| `search = "client"` | Default: load rows once, apply segment predicates, then fuzzy-rank matches. |
| `search = "source"` | Rerun `source(ctx)` as the phrase or segment changes; the source controls filtering and row order. Requests are debounced and stale results discarded. Segment `where` predicates are ignored. |
| `filter.fields` | Map source-object attribute names to [[API/search|search weights]]. Computed table `value(obj)` results are not searched unless also present in the source object. |
| `filter.pathCompletion` | On an empty phrase, `Space` inserts the current folder (or root page name); `Alt-Space` completes one path segment from the best match. |
| `filter.hashtagFilter` | Interpret `#meet` as a prefix match against row `tags`, then rank using the remaining phrase. |
| `filter.stripPrefix` | Remove a leading character before ranking. |

Inline filtering runs before `presentation.limit`. With `search = "source"`, the inline input passes its phrase to `source(ctx)`; with `search = "client"`, the view ranks the loaded rows. Segment, dropdown, and phrase filters compose in panels.

### Selection and panel interactions
`onSelect(obj, ctx)` runs when a selectable row is activated. `ctx.from` identifies a view that routed here through a prefix, when applicable. Return `false` to keep a panel open. `onSelect` and `actions` work in inline views and panels; the other options in this section are panel features.

| Option | Effect |
| --- | --- |
| `actions` | Row buttons. Each entry has `label`, `run(obj)`, optional `icon`, optional `when(obj)`, and optional `requireMode = "rw"` to hide it in read-only mode. Actions run independently of `onSelect`, disable while running, and refresh the view afterward. |
| `onCreate(phrase)` | Adds a create row for a nonempty phrase with no exact match. Activate it with `Enter` or use `Shift-Enter` anywhere in the list. |
| `keymap` | Maps browser `KeyboardEvent.key` names to callbacks receiving the selected object. Built-in navigation keys are reserved. |
| `segments` | Named panel subsets; each entry has a unique `label`, optional `where(obj)`, `icon`, `default`, single-character `prefix`, `placeholder`, and `helpText`. |
| `dropdown` | Choice filter with `options`, `key(obj)` or `where(obj, value)`, and optional labels and default. |
| `prefixViews` | Maps a character typed into an empty phrase to another registered view, for example `{ ["#"] = "std.tags" }`. |
| `onMove(obj, newName)` | Handles a desktop tree-row drop onto a folder or root. See [[#view.moveByRename]]. |

An action's `label` is its tooltip and accessible name; `run(obj)` performs it. Tree folders reach callbacks as `{ name = <path>, isFolder = true }`; a page with children keeps its own attributes and gains `isFolder`. Ask for confirmation inside `run` when an action needs it.

In client search mode, `segments[i].where(obj)` filters before fuzzy ranking. In source search mode, use `ctx.segment` instead. The active segment is remembered per view. A segment's empty `helpText` hides the panel help for that segment. `Ctrl-Left` and `Ctrl-Right` switch segments from a table panel's filter input.

`dropdown.options` is a list of `{ label, value }` entries or a function called on each source load or refresh. `dropdown.key(obj)` supplies a row's value; `where(obj, value)` is an alternative predicate, and `key` wins if both are present. `placeholder` labels the selector; `allLabel` labels its always-available unfiltered choice. `default` is an initial value or a function evaluated with the options. Saved selection takes precedence; an unavailable choice falls back to the default and then to All.

`onMove` receives the target folder plus the dragged row's last path segment as `newName`. Hovering a collapsed tree folder opens it; duplicate destinations abort with an error. `presentation.uploadFiles` and `onMove` apply to panel trees, not inline views.

## view.define(spec)
Registers a named view and optionally a [[Command]] to open it. Pass a `view.new` value as `view`, or put the content options directly in the definition. A flat row definition requires `onSelect`.

```lua
function projectView()
  return view.new {
    source = function()
      return {
        { name = "Projects/Sketchbook" },
        { name = "Projects/Garden journal" },
      }
    end,
    onSelect = function(obj) editor.navigate(obj.name) end,
  }
end

view.define {
  name = "example.projects",
  title = "Projects",
  command = "Navigate: Projects",
  dock = "rhs",
  view = projectView(),
}
```

The same function can render an inline `${projectView()}` expression. With `view = ...`, put `source`, `presentation`, and other content options inside the view value, not beside it. The registration's `title` overrides the value's title. Docked state uses the registered name independently of an inline `stateKey`. For a one-off registration, omit `view` and put the content options directly in `view.define`.

| Registration option | Effect |
| --- | --- |
| `name` | Unique view identifier. Redefining it replaces the registration, except for reserved built-in names and the `__pick:` prefix. |
| `title` | Panel title. |
| `command` | Command that opens the view. |
| `key`, `mac` | Key bindings; require `command`. |
| `menu`, `menuMac`, `menuWindows`, `menuLinux` | Native-menu placement in SilverBullet+. |
| `hide` | Hide the command from the command palette. |
| `dock` | Initial location: `"modal"` (default), `"lhs"`, `"rhs"`, `"bhs"`, `"page-top"`, or `"page-bottom"`. |
| `supportedDocks` | Allowed locations; defaults to `{ dock }` and must include the initial dock. |
| `defaultOpen` | Initial open state for a page dock; defaults to `false`. |
| `openOnStart` | Open on every boot regardless of saved state; only for `lhs`, `rhs`, or `bhs`. |
| `refreshOnOpen` | Reload when an already-open panel is activated; does not apply to inline or page-docked views. |
| `followEditor` | Make a registered sidebar follow the page you navigate to. |

`lhs` and `rhs` are resizable sidebars; `bhs` is a resizable bottom panel. They remember open state and size; sidebars also remember the filter phrase across re-focus. A page dock displays a widget above or below the document, has no filter input, and hides itself when empty. A modal is a transient picker: it clears its phrase on open and dismisses on selection unless `onSelect` returns `false`. Page-docked lists honor `presentation.limit`; page-docked trees are uncapped.

Each sidebar or bottom slot holds one view. Opening another temporarily displaces the previous one, which returns when the newcomer leaves (one level deep). Below 600px, sidebars become full-width drawers and dismiss on selection; they have no resize handle and skip boot restoration and `openOnStart`.

### Saved dock state
Registered views save their dock, open, collapsed, width, and height settings locally under `["navigator", name, field]`. Valid saved values override `view.defaults`, which override the definition. A space can supply defaults:

```lua
config.set("view.defaults", {
  ["example.projects"] = { dock = "rhs", open = true, width = 320 },
})
```

`dock` must be in `supportedDocks`. `open` applies except for modals; `collapsed` applies to page docks; `width` applies to sidebars and `height` to the bottom panel, both from 160 to 600 pixels. `Navigate: Reset All Views` clears saved choices. When two or more docks are supported, a dock menu moves the view immediately; closing it preserves that preference. Page widgets also remember their folded state.

Opening a closed panel reloads its source. Reactivating an open panel or revisiting a cached sibling reuses its rows unless `refreshOnOpen = true`. `refreshOn` events refresh loaded views.

## view.pick(spec)
Opens a one-off modal and suspends the script until the user chooses a row. It returns the original selected object, or `nil` if dismissed or replaced by another view.

```lua
local project = view.pick {
  title = "Choose a project",
  source = function()
    return {
      { name = "Projects/Sketchbook" },
      { name = "Projects/Garden journal" },
    }
  end,
  presentation = { row = { primary = "name" } },
}
if project then editor.navigate(project.name) end
```

The picker accepts row presentation, filtering, segments, dropdown, actions, keymaps, and creation options. It does not accept `content`, a registered name, command, docking options, or refresh options. Optional `onSelect(obj, ctx)` runs before resolving: returning `false` keeps the picker open; otherwise it resolves with the selected object.

## view.open(name, opts?)
Opens or focuses a registered view and returns a boolean indicating whether it opened. `name` is the name passed to `view.define`.

| Option | Effect |
| --- | --- |
| `segment` | Active segment label for this opening, overriding the default or remembered segment. |
| `phrase` | Initial filter text. |
| `dropdown` | Selected dropdown value for this opening; does not replace saved preferences. An unavailable value leaves rows unfiltered until a refresh supplies it. |
| `focus = false` | Keep editor focus. The view still refreshes or resets as on a normal open, but reactivation does not toggle it closed. |
| `quiet = true` | Suppress the notification if the named view does not exist. |

```lua
view.open("example.projects", { phrase = "Garden" })
```

## view.focus(slot?)
Focuses an open view panel's input without changing selection and returns whether a panel was available. Pass `"modal"`, `"lhs"`, `"rhs"`, or `"bhs"`, or omit `slot` to focus any open panel.

```lua
view.focus("rhs")
```
