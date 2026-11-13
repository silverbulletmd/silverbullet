---
description: Create a Lua slash command
tags: meta/template/slash
icon: md-code
group: Space Lua
onlyContexts:
- "FencedCode:space-lua"
---

slashCommand.define {
  name = "|^|",
  run = function()
    editor.insertAtCursor("Hello |^| world!", false, true)
  end
}