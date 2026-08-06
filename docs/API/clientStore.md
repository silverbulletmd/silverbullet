---
tags: api/syscall
references:
- plug-api/syscalls/client_store.ts
- client/plugos/syscalls/clientStore.ts
---

The Client Store API provides a simple key-value store for client-specific states and preferences.

<!--#lua spacelua.renderApiDocumentation("clientStore") -->
## clientStore.delete

`clientStore.delete(key)`

Deletes a client-specific value from the local key-value store.

**Parameters:**

- `key` (`string`) — Key to delete.

**Example:**

```lua
clientStore.delete("theme")
```

## clientStore.get

`clientStore.get(key)`

Gets a client-specific value from the local key-value store.

**Parameters:**

- `key` (`string`) — Key to read.

**Returns:**

- Value — Stored value, or nil when absent.

**Example:**

```lua
local theme = clientStore.get("theme")
```

## clientStore.set

`clientStore.set(key, value)`

Stores a client-specific value in the local key-value store.

**Parameters:**

- `key` (`string`) — Key to set.
- `value` — Value to store.

**Example:**

```lua
clientStore.set("theme", "dark")
```
<!--/lua-->

