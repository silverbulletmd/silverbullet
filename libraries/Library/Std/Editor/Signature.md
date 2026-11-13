Sign the current block: append your username (`/sign` puts it where you typed the `/`), or `-- @self` on an owner-only deployment without account usernames, marking the text as written by you rather than addressed to you.

```space-lua
local function blockEndOffset(text, pos)
  local at = 1
  local reached = false
  local last = nil
  while true do
    local nl = string.find(text, "\n", at, true)
    local lineEnd = nl and (nl - 1) or #text
    local line = string.sub(text, at, lineEnd)
    if not reached and pos <= lineEnd + 1 then
      reached = true
    end
    if reached then
      if line:match("^%s*$") or line:match("^%s*%-%->%s*$") then
        break
      end
      last = lineEnd
    end
    if not nl then break end
    at = nl + 1
  end
  return last
end

local function signCurrentBlock()
  local me = identity.own()
  if not me then
    editor.flashNotification(
      "This space has no account to sign as", "error")
    return
  end
  local text = editor.getText()
  local at = blockEndOffset(text, editor.getCursor())
  if not at then return end
  editor.insertAtPos(" -- @" .. me.name, at)
end

command.define {
  name = "Mention: Sign",
  run = signCurrentBlock,
}

-- `/sign`: the signature goes where the `/` was, one space from the text
-- before it
local function signAtCursor()
  local me = identity.own()
  if not me then
    editor.flashNotification(
      "This space has no account to sign as", "error")
    return
  end
  local line = editor.getCurrentLine()
  local before = string.sub(line.text, 1, editor.getCursor() - line.from)
  local spacing = string.find(before, "%S$") and " " or ""
  editor.insertAtCursor(spacing .. "-- @" .. me.name)
end

slashCommand.define {
  name = "sign",
  displayName = "Signature",
  description = "Sign the current block",
  icon = "pen-tool",
  aliases = {"signature"},
  group = "Insert",
  priority = 10,
  exceptContexts = {"FencedCode", "FrontMatter", "LuaDirective"},
  run = signAtCursor,
}
```
