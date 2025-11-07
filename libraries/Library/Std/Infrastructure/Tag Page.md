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
      from index.tag(tagName)
      order by ref
    ]]
    local subTags = query[[
      from index.tag "tag"
      where string.startsWith(_.name, tagName .. "/")
      select {name=_.name}
    ]]
    if #subTags > 0 then
      text = text .. "## Sub-tags\n"
        .. template.each(subTags, templates.tagItem)
    end
    local taggedPages = query[[
      from allObjects where table.includes(_.itags, "page")
    ]]
    if #taggedPages > 0 then
      text = text .. "## Pages\n"
        .. template.each(taggedPages, templates.pageItem)
    end
    local taggedTasks = query[[
      from allObjects where table.includes(_.itags, "task")
    ]]
    if #taggedTasks > 0 then
      text = text .. "## Tasks\n"
        .. template.each(taggedTasks, templates.taskItem)
    end
    local taggedItems = query[[
      from allObjects where table.includes(_.itags, "item")
    ]]
    if #taggedItems > 0 then
      text = text .. "## Items\n"
        .. template.each(taggedItems, templates.itemItem)
    end
    local taggedData = query[[
      from allObjects where table.includes(_.itags, "data")
    ]]
    if #taggedData > 0 then
      text = text .. "## Data\n"
        .. markdown.objectsToTable(taggedData) .. "\n"
    end
    local taggedParagraphs = query[[
      from allObjects where table.includes(_.itags, "paragraph")
    ]]
    if #taggedParagraphs > 0 then
      text = text .. "## Paragraphs\n"
        .. template.each(taggedParagraphs, templates.paragraphItem)
    end
    return text
  end
}
```
