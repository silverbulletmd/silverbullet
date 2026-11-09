---
tags: api/space-lua maturity/experimental
references:
- client/navigator/navigator.ts
- client/navigator/lua_views.ts
- client/navigator/view_spec.ts
- client/navigator/view_value.ts
---
Views place widgets: `view.define` registers a named, dockable view, `view.pick` asks the user to choose a row, and `view.open`/`view.focus` act on open views. What a view shows is a [[API/widget#Lists, trees and tables|widget]] (a list, tree, table or content function). See [[View#Widgets and views]].

## view.define(spec)
Registers a named view and optionally a [[Command]] to open it. Pass a live `widget.new` value as `widget`, or put the content options directly in the definition. A flat row definition requires `onSelect`. A flat `content` function may return Markdown, `widget.new { markdown | html | cssClasses }`, `widget.html(…)`, or a DOM node. It can’t return a live or sandboxed widget.

```space-lua
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

The same function can render an inline `${projectView()}` expression. With `widget = ...`, put `source`, `presentation`, and other content options inside the widget, not beside it. The registration’s `title` overrides the widget’s title. Docked state uses the registered name independently of an inline `stateKey`. For a one-off registration, omit `widget` and put the content options directly in `view.define`.

* `name`: Unique view identifier. Redefining it replaces the registration, except for reserved built-in names and the `__pick:` prefix.
* `title`: Panel title.
* `command`: Command that opens the view.
* `key`, `mac`: Key bindings. Require `command`.
* `menu`, `menuMac`, `menuWindows`, `menuLinux`: Native-menu placement in SilverBullet Desktop.
* `hide`: Hide the command from the command palette.
* `dock`: Initial location: `"modal"` (default), `"lhs"`, `"rhs"`, `"bhs"`, `"page-top"`, or `"page-bottom"`.
* `supportedDocks`: Allowed locations. Defaults to `{ dock }` and must include the initial dock.
* `defaultOpen`: Initial open state for a page dock. Defaults to `false` (`true` with `frame = "minimal"`).
* `frame`: `"full"` (default) or `"minimal"`. A minimal page-docked view has no title bar, fold or close. Its ⋯ menu and dock-menu buttons appear on hover. Applies to `page-top` and `page-bottom` only.
* `widget`: A `widget.new` value to show (usually with `source` or `content`). Can’t be combined with flat content fields.
* `openOnStart`: Open on every boot regardless of saved state. Only for `lhs`, `rhs`, or `bhs`.
* `refreshOnOpen`: Reload when an already-open panel is activated. Does not apply to inline or page-docked views.
* `rememberPhrase`: Reuse the modal’s last search in this browser tab unless `phrase` is supplied. Resets on reload. Intended for `search = "source"`.
* `followEditor`: Make a registered sidebar follow the page you navigate to.

`lhs` and `rhs` are resizable sidebars. `bhs` is a resizable bottom panel. They remember open state and size. Sidebars also remember the filter phrase across re-focus. A page dock displays a widget above or below the document, has no filter input, and hides itself when empty. A modal is a transient picker: it clears its phrase on open and dismisses on selection unless `onSelect` returns `false`. Page-docked lists honor `presentation.limit`. Page-docked trees are uncapped.

Each sidebar or bottom slot holds one view. Opening another temporarily displaces the previous one, which returns when the newcomer leaves (one level deep). Below 600px, sidebars become full-width drawers and dismiss on selection. They have no resize handle and skip boot restoration and `openOnStart`. The bottom panel likewise takes the full height, leaving a strip of the editor, and has no resize handle.

### Saved dock state
Registered views save their dock, open, collapsed, width and height settings locally. Valid saved values override `view.defaults`, which override the definition. A space can supply defaults:

```space-lua
config.set("view.defaults", {
  ["example.projects"] = { dock = "rhs", open = true, width = 320 },
})
```

`dock` must be in `supportedDocks`. `open` applies except for modals. `collapsed` applies to page docks. `width` applies to sidebars, from 160 to 600 pixels. `height` applies to the bottom panel, from 160 pixels up to the window height minus 200 pixels, which stay free for the editor. `Navigate: Reset All Views` clears saved choices. When two or more docks are supported, a dock menu moves the view immediately. Closing it preserves that preference. Page widgets also remember their folded state.

Opening a closed panel reloads its source. Reactivating an open panel or revisiting a cached sibling reuses its rows unless `refreshOnOpen = true`. `refreshOn` events refresh loaded views. Views also refresh when anything their `source` or `content` read changes.

## view.pick(spec)
Opens a one-off modal and suspends the script until the user chooses a row. It returns the original selected object, or `nil` if dismissed or replaced by another view.

```space-lua
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

The picker accepts row presentation, filtering, segments, dropdown, actions, keymaps, and creation options. It does not accept `content`, a registered name, command, docking options, or refresh options. Optional `onSelect(obj, ctx)` runs before resolving: returning `false` keeps the picker open. Otherwise it resolves with the selected object.

## view.open(name, opts?)
Opens or focuses a registered view and returns a boolean indicating whether it opened. `name` is the name passed to `view.define`.

* `segment`: Active segment label for this opening, overriding the default or remembered segment.
* `phrase`: Initial filter text.
* `dropdown`: Selected dropdown value for this opening. Does not replace saved preferences. An unavailable value leaves rows unfiltered until a refresh supplies it.
* `focus = false`: Keep editor focus. The view still refreshes or resets as on a normal open, but reactivation does not toggle it closed.
* `quiet = true`: Suppress the notification if the named view does not exist.

```space-lua
view.open("example.projects", { phrase = "Garden" })
```

## view.focus(slot?)
Focuses an open view panel’s input without changing selection and returns whether a panel was available. Pass `"modal"`, `"lhs"`, `"rhs"`, or `"bhs"`, or omit `slot` to focus any open panel.

```space-lua
view.focus("rhs")
```

## view.moveByRename
`view.moveByRename(obj, newName)` renames the page, document or folder represented by a tree row. Use it as `onMove` for a tree backed by space files:

```space-lua
onMove = view.moveByRename
```

The row must describe the actual file or folder: its `name`, `isFolder`, `tag` and, for a folder that is also a page, `ref`. This changes files and requires write access. Use a custom `onMove` callback for trees whose rows represent something else.
