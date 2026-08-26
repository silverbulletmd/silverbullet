#meta

Surfaces open recipient mentions in the right-hand sidebar. Open the Mention Inbox with ${widgets.commandButton("Navigate: Mentions")}.

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
  local names = {}
  for _, r in ipairs(system.invokeFunction("index.listIdentities")) do
    names[r.id] = r.name
  end
  local mentions = query[[
    from index.relations "at-mention"
  ]]
  for _, m in ipairs(mentions) do
    local hidden = false
    if m.fromTag == "task" then
      local task = index.getObjectByRef(m.page, "task", m.from)
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
        by = (function()
          if not m.by or #m.by == 0 then return nil end
          local out = {}
          for _, id in ipairs(m.by) do
            table.insert(out, "@" .. (names[id] or id:gsub("^@", "")))
          end
          return table.concat(out, " ")
        end)(),
      })
    end
  end
  -- Recipients declared in `recipients:` frontmatter address the whole page,
  -- so they have no `@nickname` span to act on: the row navigates and that's
  -- all. Its own `ref` uniquifies the tree path, the way a range does above.
  local declared = query[[
    from index.relations "recipients" where _.toTag == "identity"
  ]]
  for _, d in ipairs(declared) do
    local recipient = "@" .. d.alias
    local label = d.snippet or recipient
    table.insert(rows, {
      name = d.page .. SEP .. label .. "\30" .. d.ref,
      snippet = label,
      recipient = recipient,
      ref = d.page,
      page = d.page,
      target = d.to,
      declared = true,
    })
  end
  return rows
end

-- The recipient the current user is, when the space knows who that is. An
-- anonymous reader of a public space is nobody, and opens on all recipients.
local function ownTarget()
  local me = identity.own()
  return me and me.id
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
      decorations = function(obj)
        if obj.declared then
          return { { text = obj.recipient, position = "right" } }
        end
        -- Who asked, without opening the page.
        if obj.by then
          return { { text = obj.by, position = "right" } }
        end
      end,
      icon = function(obj)
        if obj.isFolder then
          return "file-text"
        end
        if obj.declared then
          return "at-sign"
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
      for _, r in ipairs(system.invokeFunction("index.listIdentities")) do
        table.insert(result, { label = r.name, value = r.id })
      end
      return result
    end,
    default = ownTarget,
    key = function(obj) return obj.target end,
  },
  actions = {
    -- A declared recipient has no `@nickname` span in the text, so it offers
    -- neither of these.
    { icon = "x", label = "Remove mention", requireMode = "rw",
      when = function(obj) return not obj.isFolder and not obj.declared end,
      run = function(obj)
        system.invokeFunction("index.resolveAtMention",
          obj.page, obj.range, obj.nickname, "remove")
      end },
    { icon = "trash-2", label = "Delete task/item/paragraph", requireMode = "rw",
      when = function(obj) return not obj.isFolder and not obj.declared end,
      run = function(obj)
        if not editor.confirm(
          "Delete the entire task/item/paragraph containing this mention?"
        ) then
          return
        end
        system.invokeFunction("index.resolveAtMention",
          obj.page, obj.range, obj.nickname, "delete-host")
      end },
  },
  onSelect = function(obj)
    editor.navigate(obj.ref or obj.name)
  end,
}
```
