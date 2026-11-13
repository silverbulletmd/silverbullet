---
tags: api/syscall
references:
- plug-api/syscalls/theme.ts
- client/plugos/syscalls/theme.ts
---
Inspect and switch the theme, for this device only.

<!--#lua spacelua.renderApiDocumentation("theme") -->
## theme.getActive
`theme.getActive()`

Returns the theme currently on screen: this device's override, else the space's `theme` setting, else a built-in chosen by the system's light or dark preference. While the Configuration tab previews a theme, it returns the previewed one, and the theme commands see that one too.

**Returns:**

- `table` — The active theme.

**Example:**

```space-lua
print(theme.getActive().displayName)
```

## theme.getDeviceTheme
`theme.getDeviceTheme()`

Gets the page of this device's theme override, if any.

**Returns:**

- `string?` — Theme page, or nil when unset.

**Example:**

```space-lua
local page = theme.getDeviceTheme()
```

## theme.list
`theme.list()`

Lists all installed themes: pages tagged meta/theme with a valid scheme.

**Returns:**

- `table[]` — Themes with `page`, `displayName`, `scheme` (`light` or `dark`) and, when set, `description`, `counterpart` and `fonts`.

**Example:**

```space-lua
for _, t in ipairs(theme.list()) do print(t.displayName, t.scheme) end
```

## theme.setDeviceTheme
`theme.setDeviceTheme(page?)`

Overrides the theme on this device only and applies it immediately. Pass nil to clear the override and follow the space's setting again. Errors when no installed theme has that page name.

**Parameters:**

- `page?` (`string`) — Page name of the theme, or nil to clear the override.

**Examples:**

```space-lua
theme.setDeviceTheme("Library/Std/Themes/SilverBullet Dark")
```

```space-lua
theme.setDeviceTheme(nil)
```
<!--/lua-->
