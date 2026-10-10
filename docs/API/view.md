---
tags: api/space-lua maturity/experimental
references:
- client/navigator/navigator.ts
- client/navigator/lua_views.ts
- client/navigator/view_spec.ts
- client/navigator/view_value.ts
---
Views place widgets: `view.define` registers a named, dockable view, `view.pick` asks the user to choose a row, and `view.open`/`view.focus` act on open views. What a view shows is a [[API/widget#Lists, trees and tables|widget]] (a list, tree, table or content function); see [[View#Widgets and views]].

## view.define(spec)
Registers a named view and optionally a [[Command]] to open it. Pass a live `widget.new` value as `widget`, or put the content options directly in the definition. A flat row definition requires `onSelect`. A flat `content` function may return Markdown, `widget.new { markdown | html | cssClasses }`, `widget.html(…)`, or a DOM node; it can't return a live or sandboxed widget.

```lua
function projectView()
  return widget.new {
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
  widget = projectView(),
}
```

The same function can render an inline `${projectView()}` expression. With `widget = ...`, put `source`, `presentation`, and other content options inside the widget, not beside it. The registration's `title` overrides the widget's title. Docked state uses the registered name independently of an inline `stateKey`. For a one-off registration, omit `widget` and put the content options directly in `view.define`.

| Registration option | Effect |
| --- | --- |
| `name` | Unique view identifier. Redefining it replaces the registration, except for reserved built-in names and the `__pick:` prefix. |
| `title` | Panel title. |
| `command` | Command that opens the view. |
| `key`, `mac` | Key bindings; require `command`. |
| `menu`, `menuMac`, `menuWindows`, `menuLinux` | Native-menu placement in SilverBullet Desktop. |
| `hide` | Hide the command from the command palette. |
| `dock` | Initial location: `"modal"` (default), `"lhs"`, `"rhs"`, `"bhs"`, `"page-top"`, or `"page-bottom"`. |
| `supportedDocks` | Allowed locations; defaults to `{ dock }` and must include the initial dock. |
| `defaultOpen` | Initial open state for a page dock; defaults to `false` (`true` with `frame = "minimal"`). |
| `frame` | `"full"` (default) or `"minimal"`. A minimal page-docked view has no title bar, fold or close; its ⋯ menu and dock-menu buttons appear on hover. Applies to `page-top` and `page-bottom` only. |
| `widget` | A `widget.new` value to show (usually with `source` or `content`). Can't be combined with flat content fields. |
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
