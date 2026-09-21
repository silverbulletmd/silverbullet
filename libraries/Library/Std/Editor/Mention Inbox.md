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
  local stripped = text:gsub("^[-*+]%s*%[.?%]%s*", "")
  if stripped == text then
    stripped = text:gsub("^[-*+]%s+", "")
  end
  return (stripped:gsub("^%s+", ""))
end

local function inboxRows()
  local rows = {}
  for _, m in ipairs(identity.mentions().mentions) do
    local declared = m.kind == "page"
    local recipient = "@" .. (m.nickname or m.target:sub(2))
    local snippet = recipient
    if type(m.snippet) == "string" then
      snippet = declared and m.snippet or stripMarker(m.snippet)
    end
    local authors = {}
    for _, name in ipairs(m.by) do
      table.insert(authors, "@" .. name)
    end
    table.insert(rows, {
      name = m.page .. SEP .. snippet .. "\30" .. (declared and (m.ref .. m.target) or m.pos),
      snippet = snippet,
      recipient = declared and recipient or nil,
      ref = m.ref,
      page = m.page,
      range = m.range,
      nickname = m.nickname,
      target = m.target,
      fromTag = m.fromTag,
      by = #authors > 0 and table.concat(authors, " ") or nil,
      declared = declared,
    })
  end
  return rows
end

-- The recipient the current user is, when the space knows who that is. An
-- anonymous reader of a public space is nobody and opens on all recipients;
-- an owner-only deployment without account usernames resolves to @self.
local function ownTarget()
  local me = identity.own()
  return me and me.id
end

view.define {
  name = "inbox",
  title = "Mention Inbox",
  dock = "rhs",
  supportedDocks = { "rhs", "lhs", "bhs", "modal" },
  command = "Navigate: Mentions",
  menu = { location = "view", group = "1_views", order = 5, label = "Mentions" },
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
    {
      icon = "x",
      label = "Remove mention",
      requireMode = "rw",
      when = function(obj) return not obj.isFolder and not obj.declared end,
      run = function(obj)
        system.invokeFunction("index.resolveAtMention",
          obj.page, obj.range, obj.nickname, "remove")
      end
    },
    {
      icon = "trash-2",
      label = "Delete task/item/paragraph",
      requireMode = "rw",
      when = function(obj) return not obj.isFolder and not obj.declared end,
      run = function(obj)
        if not editor.confirm(
          "Delete the entire task/item/paragraph containing this mention?"
        ) then
          return
        end
        system.invokeFunction("index.resolveAtMention",
          obj.page, obj.range, obj.nickname, "delete-host")
      end
    },
  },
  onSelect = function(obj)
    editor.navigate(obj.ref or obj.name)
  end,
}
```
