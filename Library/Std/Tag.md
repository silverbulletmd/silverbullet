#meta

Implements a tag page, that renders when navigating to a hashtag: #meta based on the `tag:` prefix, by piggy backing on the `editor:pageCreating` event that triggers for non-existing pages.

```space-lua
-- priority: 10
pageEventHandlers = pageEventHandlers or {}
pageEventHandlers.tagPage = function(e)
    if not e.data.name:startsWith("tag:") then
      return
    end
    -- Extract the tag name from the page name
    local tagName = e.data.name:sub(#"tag:" + 1)
    local text = "# Objects tagged with " .. tagName .. "\n"
    local taggedPages = query[[
      from index.tag "page"
      order by ref
      where table.includes(_.tags, tagName)
    ]]
    if #taggedPages > 0 then
      text = text .. "## Pages\n"
        .. template.each(taggedPages, templates.pageItem)
    end
    local taggedTasks = query[[
      from index.tag "task"
      order by ref
      where table.includes(_.tags, tagName)
    ]]
    if #taggedTasks > 0 then
      text = text .. "## Tasks\n"
        .. template.each(taggedTasks, templates.taskItem)
    end
    local taggedItems = query[[
      from index.tag "item"
      order by ref
      where table.includes(_.tags, tagName)
    ]]
    if #taggedItems > 0 then
      text = text .. "## Items\n"
        .. template.each(taggedItems, templates.itemItem)
    end
    local taggedParagraphs = query[[
      from index.tag "paragraph"
      order by ref
      where table.includes(_.tags, tagName)
    ]]
    if #taggedParagraphs > 0 then
      text = text .. "## Paragraphs\n"
        .. template.each(taggedParagraphs, templates.paragraphItem)
    end
    return {
      text = text,
      -- Read only page
      perm = "ro"
    }
  end

event.listen {
  name = "editor:pageCreating",
  run = function(e) return pageEventHandlers.tagPage(e) end,
}
```
