APIs related to editor commands

### command.define(commandDef)
Registers a command.

Available keys:

* `name`: Name of the command
* `run`: Callback function
* `contexts`: AST node context in which this command should be available
* `priority`: Command priority (how high it appears in the list)
* `key`: Windows/Linux key binding (and mac, if not separately defined)
* `mac`: Mac-specific key binding
* `hide`: Hide this command from the [[Command Palette]]
* `requireMode`: `rw` or `ro` — only enable this command in a particular mode (read-write, or read-only)

Example:
```lua
command.define {
  name = "My custom command",
  run = function()
    editor.flashNotification "Triggered my custom command"
  end
}
