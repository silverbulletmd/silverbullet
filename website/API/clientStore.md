The Client Store API provides a simple key-value store for client-specific states and preferences.

## clientStore.set(key, value)
Sets a value in the client store.

Example:
```lua
clientStore.set("theme", "dark")
```

## clientStore.get(key)
Gets a value from the client store.

Example:
```lua
local theme = clientStore.get("theme")
print("Current theme: " .. theme)
```

## clientStore.del(key)
Deletes a value from the client store.

Example:
```lua
clientStore.del("theme")
``` 