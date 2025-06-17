#meta

APIs to define and patch commands and slash commands.

# API

## command.define(commandDef)
Registers a command.

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
Equivalent to `command.define`, but can be used to update the definition of previously defined commands (including built-in ones).

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
  key = nil,
  mac = nil,
}
```

# Implementation
Most of the heavy lifting happens in SB itself.

```space-lua
-- priority: 99
command = command or {}
slashCommand = slashCommand or {}

-- DEPRECATED: old name of API
slashcommand = slashCommand

function command.define(def)
  config.set({"commands", def.name}, def)
end

function command.update(newDef)
  local def = config.get({"commands", newDef.name}, {})
  for k, v in pairs(newDef) do
    def[k] = v
  end
  config.set({"commands", newDef.name}, def)
end

function slashCommand.define(def)
  config.set({"slashCommands", def.name}, def)
end
```