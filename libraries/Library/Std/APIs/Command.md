---
description: APIs to define custom commands and slash commands
tags: meta/api
---

APIs to define and patch commands and slash commands.

# API

## command.define(commandDef)
Registers a command. Calling it again with the same `name` merges the new fields into the existing definition; set a field to `config.unset` to remove it.

Available keys:

* `name`: Name of the command
* `run`: Callback function
* `contexts`: AST node context in which this command should be available
* `priority`: Command priority (how high it appears in the list)
* `key`: Windows/Linux key binding (and mac, if not separately defined)
* `mac`: Mac-specific key binding
* `hide`: Hide this command from the Command Palette
* `requireMode`: `rw` or `ro` — only enable this command in a particular mode (read-write, or read-only)

Example:

```lua
command.define {
  name = "My custom command",
  run = function()
    editor.flashNotification "Triggered my custom command"
  end
}
```

## command.update(commandDef)
Equivalent to `command.define`. Kept for compatibility; use it to update the definition of previously defined commands (including built-in ones).

Example:

```lua
-- To assign a new key binding and command priority to a built-in command
command.update {
  name = "Stats: Show",
  key = "Ctrl-Shift-t",
  priority = 100
}

-- To disable key bindings of an existing command
command.update {
  name = "Navigate: Document Picker",
  key = "",
  mac = "",
}

-- To remove a field from an existing definition
command.define {
  name = "My custom command",
  priority = config.unset,
}
```

## slashCommand.define(spec)
Defines a custom slash command. Like `command.define`, repeated calls with the same `name` merge.

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

# Implementation
Most of the heavy lifting happens in SB itself. These are just wrappers around the config object API.

```space-lua
-- priority: 99
command = command or {}
slashCommand = slashCommand or {}

-- Deprecated: use command.define.
slashcommand = slashCommand

function command.define(def)
  config.merge({"commands", def.name}, def)
end

function command.update(newDef)
  config.merge({"commands", newDef.name}, newDef)
end

function slashCommand.define(def)
  config.merge({"slashCommands", def.name}, def)
end
```
