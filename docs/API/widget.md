---
tags: api/space-lua
references:
- libraries/Library/Std/APIs/Widget.md
- client/space_lua/render_widget.ts
- client/codemirror/lua_widget.ts
- client/navigator/view_value.ts
lastReviewed: "2026-06-29"
---

Widgets are values describing what to render: static Markdown or HTML, or live content that refreshes. They render wherever they're placed, often through [[Space Lua#Expressions]] — see [[View#Widgets and views]].

# Widget types
## Markdown widgets
When setting a `markdown` key, or using the `widget.markdown` API, a markdown-based widget can be created.

Example:

```space-lua
function helloWorld(name)
  return widget.markdown("Hello world, *" .. name .. "*!")
end
```

Can be used as follows:

${helloWorld("Pete")}

### Showing text without evaluating it
Markdown widgets evaluate what they render: `${...}` expressions run, and `![[Page]]` pulls in other pages. When a widget shows text written by someone else (an imported note, a form entry, an AI agent's output), pass `evaluate = false`. The text is still rendered as Markdown (formatting, lists, links), but expressions and transclusions stay literal text:

```lua
widget.markdownBlock(importedText, { evaluate = false })
widget.new { markdown = importedText, evaluate = false }
```

For text placed inside HTML, escape it with `string.escapeHtml` instead.

## DOM widgets
To render a custom HTML-based widget, use the [[API/dom]] elements passed as an argument to `widget.html`:

```space-lua
function marquee(text)
  return widget.html(dom.marquee {
    class = "my-marquee",
    onclick = function()
      editor.flashNotification "You clicked me"
    end,
    text
  })
end
```

We can combine this with some [[Space Style]] to style it:

```space-style
.my-marquee {
  color: purple;
}
```

This can be used as follows:
${marquee "Finally, marqeeeeeee!"}

## Sandboxed widgets
For widgets that need to run JavaScript, e.g. to drive a third-party rendering library, set `sandbox = true`. The `html` (and the optional `script`) then run together inside an **isolated sandbox iframe**, so the widget's scripts and styles can't interfere with the editor. (`widget.sandbox` is a shortcut that sets this for you.)

Inside the sandbox the script has access to:
* `syscall(name, ...args)` — call any [[API|syscall]] (returns a promise), e.g. `syscall("editor.navigate", "Some Page")`.
* `loadJsByUrl(url)` — load an external classic script (returns a promise that resolves once loaded).
* automatic height — the iframe sizes itself to its content.

The widget's `markdown` value (if set) is what the **Copy** button copies — handy for exposing a scripted widget's source. Sandboxed widgets render as a block.

```space-lua
function clock()
  return widget.sandbox {
    html = [[<div id="t"></div>]],
    markdown = "Not supported",
    script = [[
      var el = document.getElementById("t");
      setInterval(() => { el.innerText = new Date().toLocaleTimeString(); }, 1000);
    ]],
  }
end
```

${clock()}

# Live widgets
## widget.new { source | content }
Creates a live widget: one built from `source(ctx)`, which returns objects, or `content(ctx)`, which returns Markdown or a static widget. It re-runs them when it refreshes. A live widget can’t also set `markdown` or `html`. Render it in a page expression or pass it to `view.define` as `widget`.

**Returns:** A live widget.

For a minimal inline list that navigates on click:

${widget.new {
  source = function()
    return {
      { name = "SilverBullet" },
      { name = "Funding" },
    }
  end,
  onSelect = function(obj) editor.navigate(obj.name) end,
}}

`onSelect` makes rows selectable. To reuse the widget, return `widget.new { ... }` from a function and call that function in the expression.

### Data and refresh
| Option | Effect |
| --- | --- |
| `source(ctx)` | Returns the objects to display. Each object is passed unchanged to callbacks. |
| `content(ctx)` | Returns Markdown, a static widget (`widget.new` with `markdown`, `html` or `cssClasses`, or `widget.html(…)`) or a DOM node, or `nil` to display nothing. Content widgets have no rows or filter input. |
| `refreshOn` | What reloads the source or content; defaults to nothing. Use the trigger names `"index"` (the space index changed), `"navigate"` (another page or document opened) and `"edit"` (the open page was edited); any other entry is an event name. |
| `stateKey` | Saves an inline tree's expansion state locally, scoped to the containing page and this key. Without it, expansion is transient. |
| `title` | Adds a panel-style heading to an inline view. A registration can override it for its panel. |
| `label`, `placeholder`, `helpText` | Configure panel text: a short picker verb, filter placeholder, and help below the input. A segment can override the last two. |

`source` receives a table with `phrase`, `segment` and `dock` keys: the current filter phrase, active segment label (or `nil`), and rendering location. `content` receives the same context; an inline view has `dock = "inline"`. The source can use `ctx.dock` to return different objects for a panel and an embedded view.

For Markdown content instead of rows:
```lua
widget.new {
  refreshOn = { "navigate" },
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
${widget.new {
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

${widget.new {
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
| `onMove(obj, newName)` | Handles a desktop tree-row drop onto a folder or root. See [[API/view#view.moveByRename]]. |

An action's `label` is its tooltip and accessible name; `run(obj)` performs it. Tree folders reach callbacks as `{ name = <path>, isFolder = true }`; a page with children keeps its own attributes and gains `isFolder`. Ask for confirmation inside `run` when an action needs it.

In client search mode, `segments[i].where(obj)` filters before fuzzy ranking. In source search mode, use `ctx.segment` instead. The active segment is remembered per view. A segment's empty `helpText` hides the panel help for that segment. `Ctrl-Left` and `Ctrl-Right` switch segments from a table panel's filter input.

`dropdown.options` is a list of `{ label, value }` entries or a function called on each source load or refresh. `dropdown.key(obj)` supplies a row's value; `where(obj, value)` is an alternative predicate, and `key` wins if both are present. `placeholder` labels the selector; `allLabel` labels its always-available unfiltered choice. `default` is an initial value or a function evaluated with the options. Saved selection takes precedence; an unavailable choice falls back to the default and then to All.

`onMove` receives the target folder plus the dragged row's last path segment as `newName`. Hovering a collapsed tree folder opens it; duplicate destinations abort with an error. `presentation.uploadFiles` and `onMove` apply to panel trees, not inline views.

# API
## widget.new(spec)
To render a widget, call `widget.new` with a `spec` table setting any of the following keys:

* `markdown`: Renders the value as markdown. For `html`/sandbox widgets it is not displayed but is used as the **Copy** button's content.
* `html`: Renders a HTML DOM as a widget. It is usually used in conjunction with the [[API/dom]] API.
* `sandbox`: When `true`, render `html` (and `script`) inside an isolated sandbox iframe (see [[#Sandboxed widgets]]).
* `script`: JavaScript to run inside the sandbox iframe. Only runs when `sandbox = true`.
* `display`: Render the value either `inline` or as a `block` (defaults to `inline`).
* `cssClasses`: A list of CSS class names to set on the widget's wrapper element.
* `source` or `content`: Makes it a [[#Live widgets|live widget]] instead. Can’t be combined with `markdown` or `html`.

## widget.markdown(text)
Shortcut for `widget.new { markdown = text }`

## widget.html(htmlOrDOM)
Shortcut for `widget.new { html = htmlOrDOM }`

Usually used in conjunction with [[API/dom]].

## widget.htmlBlock(htmlOrDOM)
Shortcut for `widget.new { html = htmlOrDOM, display = "block" }`

Block-level version of `widget.html`.

## widget.markdownBlock(text)
Shortcut for `widget.new { markdown = text, display = "block" }`

Block-level version of `widget.markdown`. Useful for content that needs to render as a block element (lists, tables, headings, etc.).

## widget.sandbox(spec)
Convenience wrapper for a [[#Sandboxed widgets|sandboxed]] widget — equivalent to `widget.new` with `sandbox = true` (and `display = "block"` by default).

Keys:
* `html`
* `script`
* `markdown` (Copy-button content)
* `cssClasses`
* `display` (defaults to `block`)

