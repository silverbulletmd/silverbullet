---
description: Implements the tag page
tags: meta
---

Implements a virtual tag page, that renders when navigating to a hashtag: #meta based on the `tag:` prefix.

# Overriding
You can override the tag page with a custom implementation as follows:

```lua
virtualPage.define {
  -- Using the same pattern as the built-in definition
  pattern = "tag:(.+)",
  run = function(tagName)
    return "# Custom tag page for " .. tagName
  end
}
```

# Implementation
```space-lua
-- priority: 10
virtualPage.define {
  pattern = "tag:(.+)",
  run = function(tagName)
    local text = "# Objects tagged with " .. tagName .. "\n"
    local allObjects = query[[
      from index.objects(tagName)
      order by ref
    ]]
    local tagParts = tagName:split("/")
    local parentTags = {}
    for i in ipairs(tagParts) do
      local slice = table.pack(table.unpack(tagParts, 1, i))
      if i != #tagParts then
        table.insert(parentTags, {name=table.concat(slice, "/")})
      end
    end
    if #parentTags > 0 then
      text = text .. "## Parent tags\n"
        .. table.concat(query[[from t = parentTags select templates.tagItem(t)]])
    end
    local subTags = query[[
      from index.tags()
      where string.startsWith(_.name, tagName .. "/")
      select {name=_.name}
    ]]
    if #subTags > 0 then
      text = text .. "## Child tags\n"
        .. table.concat(query[[from t = subTags select templates.tagItem(t)]])
    end
    local taggedPages = query[[
      from o = allObjects where table.includes(o.itags, "page") select templates.pageItem(o)
    ]]
    if #taggedPages > 0 then
      text = text .. "## Pages\n" .. table.concat(taggedPages)
    end
    local taggedTasks = query[[
      from o = allObjects where table.includes(o.itags, "task") select templates.taskItem(o)
    ]]
    if #taggedTasks > 0 then
      text = text .. "## Tasks\n" .. table.concat(taggedTasks)
    end
    local taggedItems = query[[
      from o = allObjects where table.includes(o.itags, "item") select templates.itemItem(o)
    ]]
    if #taggedItems > 0 then
      text = text .. "## Items\n" .. table.concat(taggedItems)
    end
    local taggedData = query[[
      from allObjects where table.includes(_.itags, "data")
    ]]
    if #taggedData > 0 then
      text = text .. "## Data\n"
        .. markdown.objectsToTable(taggedData) .. "\n"
    end
    local taggedParagraphs = query[[
      from o = allObjects where table.includes(o.itags, "paragraph") select templates.paragraphItem(o)
    ]]
    if #taggedParagraphs > 0 then
      text = text .. "## Paragraphs\n" .. table.concat(taggedParagraphs)
    end
    return text
  end
}
```
