---
tags: api/syscall
references:
- plug-api/syscalls/client_store.ts
- client/plugos/syscalls/clientStore.ts
---
Store device-specific state and preferences as key-value pairs.

<!--#lua spacelua.renderApiDocumentation("clientStore") -->
## clientStore.delete
`clientStore.delete(key)`

Deletes a client-specific value from the local key-value store.

**Parameters:**

- `key` (`string`) — Key to delete.

**Example:**

```space-lua
clientStore.delete("sidebarWidth")
```

## clientStore.get
`clientStore.get(key)`

Gets a client-specific value from the local key-value store.

**Parameters:**

- `key` (`string`) — Key to read.

**Returns:**

- Value — Stored value, or nil when absent.

**Example:**

```space-lua
local sidebarWidth = clientStore.get("sidebarWidth")
```

## clientStore.set
`clientStore.set(key, value)`

Stores a client-specific value in the local key-value store.

**Parameters:**

- `key` (`string`) — Key to set.
- `value` — Value to store.

**Example:**

```space-lua
clientStore.set("sidebarWidth", 300)
```
<!--/lua-->

