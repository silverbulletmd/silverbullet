APIs to create [[Slash Commands]]. For simple cases it is recommended to use [[Library/Std/Slash Templates]] instead.

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

