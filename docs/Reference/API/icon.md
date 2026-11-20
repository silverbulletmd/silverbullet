---
tags: api/syscall
references:
- plug-api/syscalls/icon.ts
- client/plugos/syscalls/icon.ts
- plug-api/ui/icons/registry.ts
---
Render icons as SVG markup for [[Reference/Concepts/Widget|widgets]] and custom panels.

<!--#lua spacelua.renderApiDocumentation("icon") -->
## icon.svg
`icon.svg(name)`

Renders a [Lucide](https://lucide.dev/icons) icon to SVG markup by name, or nil when the name isn’t an icon. The markup carries no color of its own (`currentColor`) and a default 24x24 size, both of which CSS at the injection site can override.

**Parameters:**

- `name` (`string`) — A Lucide icon name, e.g. `trash-2`.

**Returns:**

- `string` — The icon’s SVG markup, or nil when unknown.

**Example:**

```space-lua
local lock = icon.svg("lock")
```

## icon.resolve
`icon.resolve(names)`

Renders a batch of Lucide icons to SVG markup in one round trip, so panels can show icons without bundling the icon set themselves. Unknown names are omitted from the result. The markup carries no color of its own (`currentColor`) and a default 24x24 size, both of which CSS at the injection site can override.

**Parameters:**

- `names` (`table`) — Lucide icon names, e.g. `trash-2`.

**Returns:**

- `table` — Map of icon name to SVG markup.

## icon.names
`icon.names()`

Lists every available Lucide icon name, sorted.

**Returns:**

- `table` — Icon names.

## icon.feather
`icon.feather(name)`

Deprecated: use `icon.svg`.

## icon.resolveFeather
`icon.resolveFeather(names)`

Deprecated: use `icon.resolve`.
<!--/lua-->

Use `icon.svg` for a single name in hand right away — widget HTML, a custom panel’s content. `icon.resolve` batches several names in one round trip. Don’t call either for [[API/view|view]] icons, though: name them in the view instead (`icon = "lock"`) and the view renders them. See [[API/widget#Presentation]].

See [[Icons]] for the icon names you can use. `icon.feather` and `icon.resolveFeather` still work for one release; they now render Lucide icons and log a deprecation warning.
