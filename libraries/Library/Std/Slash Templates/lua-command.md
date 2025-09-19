---
description: Create a Lua command
tags: meta/template/slash
onlyContexts:
- "FencedCode:space-lua"
---
command.define {
  name = "|^|",
  run = function()
    editor.flashNotification "Hello world!"
  end
}