---
tags: api/syscall
references:
- plug-api/syscalls/datastore.ts
- client/plugos/syscalls/datastore.ts
- client/data/datastore.ts
---

The Datastore API provides functions for interacting with a key-value store that has query capabilities.

* **Keys** are represented as a list (Lua table) of strings.
* **Values** can be any persistable value.

<!--#lua spacelua.renderApiDocumentation("datastore") -->
## datastore.batchDelete

`datastore.batchDelete(keys)`

Deletes multiple values from the key-value store.

**Parameters:**

- `keys` (`table`) — List of keys to delete.

**Example:**

```lua
datastore.batchDelete({{"user", "1"}, {"user", "2"}})
```

## datastore.batchGet

`datastore.batchGet(keys)`

Gets multiple values from the key-value store.

**Parameters:**

- `keys` (`table`) — List of keys to read.

**Returns:**

- `table` — Values in key order, with nil for missing keys.

**Example:**

```lua
local values = datastore.batchGet({{"user", "1"}, {"user", "2"}})
```

## datastore.batchSet

`datastore.batchSet(entries)`

Sets multiple key-value entries in one operation.

**Parameters:**

- `entries` (`table`) — Entries with key and value fields.

**Example:**

```lua
datastore.batchSet({
  {key = {"user", "1"}, value = {name = "Alice"}},
  {key = {"user", "2"}, value = {name = "Bob"}},
})
```

## datastore.delete

`datastore.delete(key)`

Deletes a value from the key-value store.

**Parameters:**

- `key` (`table`) — Key segments.

**Example:**

```lua
datastore.delete({"user", "123"})
```

## datastore.get

`datastore.get(key)`

Gets a value from the key-value store.

**Parameters:**

- `key` (`table`) — Key segments.

**Returns:**

- Value — Stored value, or nil when absent.

**Example:**

```lua
local user = datastore.get({"user", "123"})
```

## datastore.query

`datastore.query(options)`

Queries key-value entries, optionally restricted to a key prefix.

**Parameters:**

- `options` (`table`) — Query options, including an optional prefix.

**Returns:**

- `table` — Matching key-value entries.

## datastore.queryLua

`datastore.queryLua(prefix, query, scopeVariables?)`

Runs a Space Lua collection query over a key prefix.

**Parameters:**

- `prefix` (`table`) — Key prefix to query.
- `query` (`table`) — Parsed collection query.
- `scopeVariables?` (`table`) — Additional variables available to the query.

**Returns:**

- `table` — Query results converted to Lua values.

## datastore.set

`datastore.set(key, value)`

Sets a value in the key-value store.

**Parameters:**

- `key` (`table`) — Key segments.
- `value` — Value to store.

**Example:**

```lua
datastore.set({"user", "123"}, {name = "John"})
```
<!--/lua-->

