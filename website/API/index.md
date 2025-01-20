The `index` API provides functions for interacting with SilverBullet's [[Objects]], allowing you to store and query page-associated data.

## Object Operations

### index.index_objects(page, objects)
Indexes an array of objects for a specific page.

Example:
```lua
local objects = {
    {tag = "mytask", ref="task1", content = "Buy groceries"},
    {tag = "mytask", ref="task2", content = "Write docs"}
}
index.index_objects("my page", objects)
```

### index.query_lua_objects(tag, query, scoped_variables?)
Queries objects using a Lua-based collection query.

Example:
```lua
local tasks = index.query_lua_objects("mytask", {limit=3})
```

### index.get_object_by_ref(page, tag, ref)
Retrieves a specific object by its reference.

Example:
```lua
local task = index.get_object_by_ref("my page", "mytask", "task1")
if task then
    print("Found task: " .. task.content)
end
```
