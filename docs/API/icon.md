---
tags: api/syscall
references:
- plug-api/syscalls/icon.ts
- client/plugos/syscalls/icon.ts
- client/lib/feather_icons.ts
---

The `icon` API renders icons as SVG markup, for [[Space Lua/Widget|widget]] HTML and other custom panel content that wants one without bundling an icon set of its own.

<!--#lua spacelua.renderApiDocumentation("icon") -->
## icon.feather

`icon.feather(name)`

Renders a Feather icon to SVG markup by name, or nil when the name isn't a Feather icon. The markup carries no color of its own (`currentColor`) and a default 24x24 size, both of which CSS at the injection site can override.

**Parameters:**

- `name` (`string`) — A Feather icon name, e.g. `trash-2`.

**Returns:**

- `string` — The icon's SVG markup, or nil when unknown.

**Example:**

```lua
local lock = icon.feather("lock")
```

## icon.resolveFeather

`icon.resolveFeather(names)`

Renders a batch of Feather icons to SVG markup in one round trip, so panels can show icons without bundling the icon set themselves. Unknown names are omitted from the result. The markup carries no color of its own (`currentColor`) and a default 24x24 size, both of which CSS at the injection site can override.

**Parameters:**

- `names` (`table`) — Feather icon names, e.g. `trash-2`.

**Returns:**

- `table` — Map of icon name to SVG markup.
<!--/lua-->

Use `icon.feather` for a single name in hand right away — widget HTML, a custom panel's content. `icon.resolveFeather` batches several names in one round trip, which is what [[API/view|view]] icons use internally — don't call either for those, though: name them in the view instead (`icon = "lock"`, or `icon = "feather:lock"`) and the navigator resolves them itself, lazily and in one batch per view refresh. See [[API/view#Row icons]].

[Feathericons.com](https://feathericons.com) lists the available names. The namespace is the point, not the implementation: `icon.feather`/`icon.resolveFeather` are the first of what could eventually be more than one icon set, each reached the same way (`icon.<set>...`) if and when a second one arrives — `icon.lucide`, say.
