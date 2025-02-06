The `index` API provides functions for interacting with SilverBullet's [[Objects]], allowing you to store and query page-associated data.

## Object Operations

## index.tag(name)
Returns a given [[Objects#Tags]] as a query collection, to be queried using [[Space Lua/Lua Integrated Query]].

Example:

${query[[from index.tag("page") limit 1]]}

## index.indexObjects(page, objects)
Indexes an array of objects for a specific page.

Example:
```lua
local objects = {
    {tag = "mytask", ref="task1", content = "Buy groceries"},
    {tag = "mytask", ref="task2", content = "Write docs"}
}
index.indexObjects("my page", objects)
```

## index.queryLuaObjects(tag, query, scopedVariables?)
Queries objects using a Lua-based collection query.

Example:
```lua
local tasks = index.queryLuaObjects("mytask", {limit=3})
```

## index.getObjectByRef(page, tag, ref)
Retrieves a specific object by its reference.

Example:
```lua
local task = index.getObjectByRef("my page", "mytask", "task1")
if task then
    print("Found task: " .. task.content)
end
