#meta

Surfaces open recipient mentions in the right-hand sidebar. Open the Mention Inbox with ${widgets.commandButton("Navigate: Mentions")} and pick a recipient from the dropdown to narrow the list, or leave it on All Recipients to see every open mention.

# Implementation
```space-lua
-- priority: 10

local SEP = "\31"

-- Task/item snippets carry their source markdown's list marker (e.g. "* [ ] ",
-- "- [x] "); the row's own icon already says what kind of row it is, so strip
-- the marker for display.
local function stripMarker(text)
  if not text then return text end
  local stripped = text:gsub("^[-*+]%s*%[.?%]%s*", "")
  if stripped == text then
    stripped = text:gsub("^[-*+]%s+", "")
  end
  return (stripped:gsub("^%s+", ""))
end

local function inboxRows()
  local rows = {}
  local mentions = query[[
    from index.relations "at-mention"
  ]]
  for _, m in ipairs(mentions) do
    local hidden = false
    if m.fromTag == "task" then
      -- Indexing a `query[[...]]` result directly (`query[[...]][1]`) fails
      -- to parse; splitting the index onto its own line works around it.
      local tasks = query[[
        from index.tag "task" where _.ref == m.from limit 1
      ]]
      local task = tasks[1]
      hidden = task and task.done or false
    end
    if not hidden then
      local snippet = stripMarker(m.snippet) or ("@" .. (m.alias or ""))
      -- Two mentions in one paragraph share a snippet, but a tree path is a
      -- row's identity -- equal paths collapse onto one node, losing rows.
      -- The range offset keeps each mention's path unique; `snippet` is what
      -- the row displays.
      table.insert(rows, {
        name = m.page .. SEP .. snippet .. "\30" .. m.range[1],
        snippet = snippet,
        ref = m.page .. "@" .. m.range[1],
        page = m.page,
        range = m.range,
        nickname = m.alias,
        target = m.to,
        fromTag = m.fromTag,
        hasPage = m.toTag == "page",
      })
    end
  end
  return rows
end

navigator.define {
  name = "inbox",
  title = "Mention Inbox",
  dock = "rhs",
  command = "Navigate: Mentions",
  key = "Ctrl-Alt-i",
  mac = "Cmd-Shift-i",
  filter = false,
  refreshOn = { "file:changed", "file:deleted", "mq:emptyQueue:indexQueue" },
  refreshOnOpen = true,
  source = inboxRows,
  presentation = {
    mode = "tree",
    hierarchy = { field = "name", separator = "\31" },
    expandAll = true,
    row = {
      primary = function(obj)
        return obj.snippet
      end,
      -- Tree rows display `label` (falling back to the path segment, which
      -- here carries the uniquifying range suffix).
      label = function(obj)
        return obj.snippet
      end,
      icon = function(obj)
        if obj.isFolder then
          return "file-text"
        end
        if obj.fromTag == "task" then
          return "check-square"
        end
        if obj.fromTag == "item" then
          return "list"
        end
        return "message-circle"
      end,
    },
  },
  dropdown = {
    placeholder = "Recipient",
    allLabel = "All Recipients",
    options = function()
      local result = {}
      for _, r in ipairs(system.invokeFunction("index.listRecipients")) do
        table.insert(result, { label = r.nickname, value = r.target })
      end
      return result
    end,
    where = function(obj, value) return obj.target == value end,
  },
  actions = {
    -- An implicit recipient has no page to link to, so pageless mentions
    -- only offer Remove/Delete.
    { icon = "link", label = "Resolve to link", requireMode = "rw",
      when = function(obj) return not obj.isFolder and obj.hasPage end,
      run = function(obj)
        system.invokeFunction("index.resolveAtMention",
          obj.page, obj.range, obj.nickname, obj.target, "link")
      end },
    { icon = "x", label = "Remove mention", requireMode = "rw",
      when = function(obj) return not obj.isFolder end,
      run = function(obj)
        system.invokeFunction("index.resolveAtMention",
          obj.page, obj.range, obj.nickname, obj.target, "remove")
      end },
    { icon = "trash-2", label = "Delete task/item/paragraph", requireMode = "rw",
      when = function(obj) return not obj.isFolder end,
      run = function(obj)
        if not editor.confirm(
          "Delete the entire task/item/paragraph containing this mention?"
        ) then
          return
        end
        system.invokeFunction("index.resolveAtMention",
          obj.page, obj.range, obj.nickname, obj.target, "delete-host")
      end },
  },
  onSelect = function(obj)
    editor.navigate(obj.ref or obj.name)
  end,
}
```
