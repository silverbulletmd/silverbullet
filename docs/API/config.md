---
tags: api/syscall
references:
- plug-api/syscalls/config.ts
- client/plugos/syscalls/config.ts
- client/config.ts
- client/plugos/syscalls/config_persist.ts
- client/workbench/configuration/config_page.ts
---

The Config API provides functions for managing configuration values, defining their JSON schemas, and exposing them in the [[Workbench/Configuration|Configuration tab]] UI.

<!--#lua spacelua.renderApiDocumentation("config") -->
## config.define

`config.define(key, schema)`

Defines a JSON schema for a configuration key.

**Parameters:**

- `key` (`string`) — Configuration key.
- `schema` (`table`) — JSON Schema definition; default applies a missing value and ui annotations expose it in the Configuration tab of the Workbench.

**Example:**

```lua
config.define("shortWikiLinks", {
  description = "Render short wiki link labels",
  type = "boolean",
  default = true,
  ui = {category = "Editor", label = "Short wiki links", priority = 1},
})
```

## config.defineCategory

`config.defineCategory(definition)`

Defines or updates a category of the Workbench Configuration tab.

**Parameters:**

- `definition` (`table`) — Category name, description, and priority.

**Example:**

```lua
config.defineCategory {
  name = "Editor",
  description = "Page editor behavior.",
  priority = 50,
}
```

## config.get

`config.get(path, defaultValue)`

Gets a configuration value by path, with dot notation support.

**Parameters:**

- `path` (`string`) — Configuration path.
- `defaultValue` — Value returned when the path is absent.

**Returns:**

- Value — Configured value or the supplied default.

**Example:**

```lua
local theme = config.get("theme", "light")
```

## config.getCategories

`config.getCategories()`

Gets all categories of the Workbench Configuration tab.

**Returns:**

- `table` — Category definitions keyed by name.

## config.getSchemas

`config.getSchemas()`

Gets all defined configuration schemas.

**Returns:**

- `table` — Schemas keyed by configuration path.

## config.getValues

`config.getValues()`

Gets all configuration values as a single table.

**Returns:**

- `table` — All configuration values.

## config.has

`config.has(path)`

Checks whether a configuration path exists.

**Parameters:**

- `path` (`string`) — Configuration path.

**Returns:**

- `boolean` — Whether the path exists.

## config.insert

`config.insert(path, value)`

Appends a value to the configuration array at a path.

**Parameters:**

- `path` — Configuration path.
- `value` — Value to append.

## config.merge

`config.merge(path, values)`

Shallow-merges a table into the table at a path: given fields replace existing ones, fields set to config.unset are removed, and other existing fields are kept.

**Parameters:**

- `path` — Configuration path.
- `values` (`table`) — Fields to merge in.

**Examples:**

```lua
config.merge({"commands", "Say hello"}, {key = "Ctrl-Alt-h"})
```

```lua
config.merge({"commands", "Say hello"}, {key = config.unset})
```

## config.persist

`config.persist(path, value)`

Persists one configuration value: writes or replaces its `config.set` line in the managed block of CONFIG, then reloads configuration.

**Parameters:**

- `path` (`string`) — Configuration path.
- `value` — Value to persist.

**Examples:**

```lua
config.persist("share.silverbullet.spaces", {"https://example.com/notes"})
```

## config.set

`config.set(path, value)`
`config.set(values)`

Sets one configuration value or multiple values at once.

**Parameters:**

- `pathOrValues` — Configuration path or table of values.
- `value?` — Value to set when a path is supplied.

**Examples:**

```lua
config.set("theme", "dark")
```

```lua
config.set({theme = "dark", fontSize = 14})
```

## config.setLuaValue

`config.setLuaValue(path, value)`
`config.setLuaValue(values)`

Sets configuration while preserving the supplied Lua value representation.

**Parameters:**

- `pathOrValues` — Configuration path or table of values.
- `value?` — Lua value to preserve.
<!--/lua-->

## Configuration tab guide

Schemas registered through `config.define` support two extensions on top of plain JSON Schema:

* `default`: when present, the value is automatically applied if the key is not already set.
* `ui`: optional annotations that expose the field in the [[Workbench/Configuration|Configuration tab]].

### `ui` annotations

Only fields that have a `ui` attribute appear in the [[Workbench/Configuration|Configuration tab]]. Recognized properties:

* `category` (required): name of the category (tab) the field appears under. It should match a `config.defineCategory` name; otherwise the category appears at the bottom in alphabetical order.
* `label`: human-readable label shown next to the control.
* `priority`: number used to sort fields within a category in descending order. Fields without a priority sort as `0`.
* `inputType`: for `string` fields, set this to `"password"` to render a masked input.

The control shown depends on the schema `type`:

* `boolean`: checkbox
* `string` with `enum`: dropdown
* `string`: text input, or password input when `ui.inputType` is `"password"`
* `number`: number input
* Anything else: a "Configure manually in CONFIG" hint; the user must edit the [[CONFIG]] page directly

The field's `description` is shown as helper text below the label.

Nested schemas can carry their own `ui` annotations. When a parent object's children all have `ui` set, the parent itself is skipped and each child appears as an individual field. This is how related options such as `smartQuotes.double.left` and `smartQuotes.double.right` become separate rows in the same category.

### Categories

Registered categories appear in descending `priority`, with higher values first. A category's optional `description` appears at the top of the category. Categories referenced by a schema but never registered appear after registered categories in alphabetical order.


## Merging and removing values

`config.merge(path, values)` shallow-merges a table into the table at `path`: fields in `values` replace existing ones, and all other existing fields are kept. This is what the `*.define` APIs (`command.define`, `tag.define`, `taskState.define` etc.) use, so calling them again with the same name adds to or overrides an earlier definition rather than replacing it.

Lua tables can't hold `nil`, so to remove a field set it to the special `config.unset` value:

```lua
-- Removes the key binding from an earlier definition, keeps everything else
command.define {
  name = "My custom command",
  key = config.unset,
}
```

`config.set(path, config.unset)` removes the value at `path` altogether.

## Writing the CONFIG page

`config.set` only changes the running configuration. To persist a value, use `config.persist(path, value)`: it writes or replaces exactly one `config.set(path, value)` line in the managed block of the [[CONFIG]] page, leaves everything else untouched, and reloads configuration. If CONFIG doesn't exist yet, it is created.

```lua
config.persist("share.silverbullet.spaces", {"https://example.com/notes"})
```

`value` may be a string, number, boolean, or a table of those.
