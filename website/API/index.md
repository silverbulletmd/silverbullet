---
testattribute: 10
---

#apidoc

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
```

## index.extractFrontmatter(text, extractOptions)
Extracts frontmatter from a markdown document (whose text is provided as argument), possibly cleaning it up. It also parses top-level tags consistent with SilverBullet's tag indexing system.

It returns a table with two keys:
- `frontmatter`: A table containing the parsed frontmatter.
- `text`: The text of the document, with any changes applied requested with the `extractOptions`.

The `extractOptions` is an optional table that can contain the following keys (which will affect the returned `text`):
- `removeKeys`: An array of keys to remove from the frontmatter.
- `removeTags`: A boolean or array of tags to remove from the frontmatter.
- `removeFrontmatterSection`: A boolean to remove the frontmatter section from the document.

Example applied to this page:
${(index.extractFrontmatter(editor.getText())).frontmatter}