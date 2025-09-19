---
description: Create a Lua slash command
tags: meta/template/slash
onlyContexts:
- "FencedCode:space-lua"
---

slashCommand.define {
  name = "|^|",
  run = function()
    editor.insertAtCursor("Hello |^| world!", false, true)
  end
}