#api/syscall

The Config API provides functions for managing configuration values.

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
Defines a JSON schema for a configuration key. The schema will be used to validate values when setting this key.

Parameters:
- `key`: The configuration key to define a schema for
- `schema`: The JSON schema to validate against

Example:
```lua
config.define("theme", {
    type = "string",
    enum = {"light", "dark"}
})
```