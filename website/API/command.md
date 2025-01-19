APIs related to editor commands

### command.define(command_def)
Registers a command.

Example:
```lua
command.define {
  name = "My custom command",
  run = function()
    editor.flash_notification "Triggered my custom command"
  end
}
```
