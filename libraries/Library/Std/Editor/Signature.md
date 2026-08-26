#meta

Sign the current block: append `-- @you`, marking the text as written by you
rather than addressed to you.

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

slashCommand.define {
  name = "sign",
  description = "Sign the current block",
  run = signCurrentBlock,
}
```
