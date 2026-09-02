---
tags: api/syscall
references:
- plug-api/syscalls/config.ts
- client/plugos/syscalls/config.ts
- client/config.ts
- plugs/configuration-manager/configuration.ts
---

The Config API provides functions for managing configuration values, defining their JSON schemas, and exposing them in the [[Features/Configuration Manager]] UI.

<!--#lua spacelua.renderApiDocumentation("config") -->
## config.define

`config.define(key, schema)`

Defines a JSON schema for a configuration key.

**Parameters:**

- `key` (`string`) — Configuration key.
- `schema` (`table`) — JSON Schema definition; default applies a missing value and ui annotations expose it in the Configuration Manager.

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

Defines or updates a Configuration Manager UI category.

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

Gets all Configuration Manager UI categories.

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

## Configuration Manager guide

Schemas registered through `config.define` support two extensions on top of plain JSON Schema:

* `default`: when present, the value is automatically applied if the key is not already set.
* `ui`: optional annotations that expose the field in the [[Features/Configuration Manager]].

### `ui` annotations

Only fields that have a `ui` attribute appear in the [[Features/Configuration Manager]]. Recognized properties:

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

