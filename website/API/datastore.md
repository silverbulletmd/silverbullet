The Datastore API provides functions for interacting with a key-value store that has query capabilities.

# Key-Value Operations

## datastore.set(key, value)
Sets a value in the key-value store.

Example:
```lua
datastore.set("user:123", {name = "John", age = 30})
```

## datastore.get(key)
Gets a value from the key-value store.

Example:
```lua
local user = datastore.get("user:123")
print(user.name)  -- prints "John"
```

## datastore.del(key)
Deletes a value from the key-value store.

Example:
```lua
datastore.del("user:123")
```

# Batch Operations

## datastore.batchSet(kvs)
Sets multiple key-value pairs in a single operation.

Example:
```lua
local kvs = {
    {key = "user:1", value = {name = "Alice"}},
    {key = "user:2", value = {name = "Bob"}}
}
datastore.batchSet(kvs)
```

## datastore.batchGet(keys)
Gets multiple values in a single operation.

Example:
```lua
local keys = {"user:1", "user:2"}
local values = datastore.batchGet(keys)
for _, value in ipairs(values) do
    print(value.name)
end
```

## datastore.batchDel(keys)
Deletes multiple values in a single operation.

Example:
```lua
local keys = {"user:1", "user:2"}
datastore.batchDel(keys)
