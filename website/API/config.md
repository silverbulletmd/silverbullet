#api/syscall

The Config API provides functions for managing configuration values, defining their JSON schemas, and exposing them in the [[Configuration Manager]] UI.

### config.get(path, defaultValue)
Gets a config value by path, with support for dot notation.

Parameters:
- `path`: The path to get the value from
- `defaultValue`: The default value to return if the path doesn't exist

Example:
```lua
local theme = config.get("theme", "light")
print("Current theme: " .. theme)
```

### config.set(path, value)
Sets a config value by path, with support for dot notation.

Parameters:
- `path`: The path to set the value at
- `value`: The value to set

Example:
```lua
config.set("theme", "dark")
```

### config.set(values)
Sets multiple config values at once.

Parameters:
- `values`: An object containing key-value pairs to set

Example:
```lua
config.set({
    theme = "dark",
    fontSize = 14
})
```

### config.has(path)
Checks if a config path exists.

Parameters:
- `path`: The path to check

Example:
```lua
if config.has("theme") then
    print("Theme is configured")
end
```

### config.define(key, schema)
Defines a JSON schema for a configuration key. The schema is used to validate values when setting this key, and (with the right annotations) to surface the option in the [[Configuration Manager]].

Parameters:
- `key`: The configuration key to define a schema for (dot notation supported for nested keys)
- `schema`: The JSON schema to validate against

Two extensions on top of plain JSON Schema:

* `default`: when present, the value is automatically applied if the key is not already set.
* `ui` (optional): annotations that opt this field into the [[Configuration Manager]] UI. See below.

Example:

```lua
config.define("shortWikiLinks", {
  description = "Render wiki links to just the last segment, e.g. Person/John becomes John",
  type = "boolean",
  default = true,
  ui = { category = "Editor", label = "Short wiki links", priority = 1 },
})
```

#### `ui` annotations
Only fields that have a `ui` attribute set appear in the [[Configuration Manager]]. Recognized properties:

* `category` (required): name of the category (tab) the field appears under. Should match a `config.defineCategory` name (otherwise the category appears at the bottom in alphabetical order).
* `label`: Human-readable label shown next to the control.
* `priority`: Number used to sort fields within a category (descending — higher `priority` appears first). Fields without `priority` sort as `0`.
* `inputType`: For `string` fields: set to `"password"` to render a masked input.

The control shown depends on the schema `type`:

* `boolean`: Checkbox
* `string` with `enum`: Dropdown
* `string`: Text input (or password input if `ui.inputType = "password"`)
* `number`: Number input
* Anything else: A "Configure manually in CONFIG" hint (the user has to edit the [[CONFIG]] page directly)

The field's `description` is shown as helper text below the label.

Nested schemas can carry their own `ui` annotations — when a parent object's children all have `ui` set, the parent itself is skipped and each child surfaces as an individual field. This is how related options (like `smartQuotes.double.left`, `smartQuotes.double.right`, …) end up as separate rows in the same category.

### config.defineCategory(definition)
Registers (or updates) a UI category for the [[Configuration Manager]]. Categories appear in the UI in descending `priority` (higher first); categories that are referenced by a schema's `ui.category` but never registered fall to the bottom in alphabetical order.

Parameters:
- `definition`: an object with the following fields:
  - `name` (required): the category name; must match the value used in schemas' `ui.category`.
  - `description` (optional): a short description shown at the top of the category.
  - `priority` (optional): number controlling the order categories appear in (descending — higher first).

Example:

```lua
config.defineCategory {
  name = "Editor",
  description = "Behavior of the page editor: brackets, wiki link rendering, emoji aliases, and similar editing affordances.",
  priority = 50,
}
```

### config.getCategories()
Returns the map of currently registered category definitions, keyed by `name`. Mostly useful for the Configuration Manager itself; rarely needed in user code.
