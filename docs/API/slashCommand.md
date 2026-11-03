---
tags: api/space-lua
references:
- libraries/Library/Std/APIs/Command.md
- client/plugos/hooks/slash_command.ts
- plug-api/types/manifest.ts
---
Define [[Slash Command|slash commands]]. For reusable text snippets, use [[Slash Templates]] instead.

## slashCommand.define(spec)
Define a custom slash command.

Supported keys in the spec:

* `name`: name of the command
* `description`: Description of the command
* `run`: The callback function that will be invoked once the command is run.

Example:

```lua
slashCommand.define {
  name = "hello-world",
  run = function()
    editor.insertAtCursor("Hello |^| world!", false, true)
  end
}
```

