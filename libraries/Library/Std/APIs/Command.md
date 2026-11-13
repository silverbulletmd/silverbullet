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
* `opensInput`: set to `true` when the command opens a picker or another text input, so running it from a tap (an action button, say) on a phone or tablet brings up the on-screen keyboard right away

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

* `name`: name of the command, what you type after `/`
* `displayName`: the label shown in the menu instead of `name` (e.g. "Heading 1" for `h1`)
* `description`: Description of the command
* `icon`: a [Feather](https://feathericons.com) icon name, an `md-*` editor icon, or inline `<svg>` markup
* `aliases`: more words that find the command when typed after `/`
* `group`: the menu section it's listed under (e.g. `Basic blocks`)
* `priority`: higher sorts earlier within its group
* `onlyContexts`, `exceptContexts`: where it's offered
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

--- Registers a command, or merges `def` into an existing command with the same name; set a field to `config.unset` to remove it.
--- @param def table { name: string, run: function, contexts?: string[], priority?: number, key?: string, mac?: string, hide?: boolean, requireMode?: "rw"|"ro", opensInput?: boolean }
--- @see API/command
function command.define(def)
  config.merge({"commands", def.name}, def)
end

--- Equivalent to `command.define`; kept for compatibility, e.g. to change the key binding of a built-in command.
--- @param newDef table { name: string } plus any keys accepted by `command.define`
--- @see API/command
function command.update(newDef)
  config.merge({"commands", newDef.name}, newDef)
end

--- Defines a slash command, or merges `def` into an existing one with the same name.
--- @param def table { name: string, run: function, displayName?: string, description?: string, icon?: string, aliases?: string[], group?: string, priority?: number, onlyContexts?: string[], exceptContexts?: string[] }
--- @see API/slashCommand
function slashCommand.define(def)
  config.merge({"slashCommands", def.name}, def)
end

local function withCursor(text)
  text = (string.gsub(text, "\n+$", ""))
  if not string.find(text, "|^|", 1, true) then
    text = text .. "|^|"
  end
  return text
end

-- A line break to end a block with, when the line after `line` has text that
-- would otherwise run into it
local function separatorAfter(line)
  local doc = editor.getText()
  if line.to >= #doc then
    return ""
  end
  local nextLine = string.match(string.sub(doc, line.to + 2), "^[^\n]*")
  return string.find(nextLine, "%S") and "\n" or ""
end

--- Inserts `text` as a block of its own where a slash command ran: in place of an empty line, else after the current line, with a blank line between. `|^|` in `text` places the cursor.
--- @param text string
--- @see API/slashCommand
function slashCommand.insertBlock(text)
  text = withCursor(text)
  local line = editor.getCurrentLine()
  if not string.find(line.text, "%S") then
    editor.replaceRange(line.from, line.to, text .. separatorAfter(line), true)
    return
  end
  -- Without trailing whitespace (the space typed before the `/`)
  local trimmed = string.gsub(line.text, "%s+$", "")
  editor.replaceRange(line.from + #trimmed, line.to,
    "\n\n" .. text .. separatorAfter(line), true)
end

--- Turns the current line into `text`: the line's text goes where `|^|` is (and the cursor after it). On an empty line, `text` is inserted as is.
--- @param text string
--- @see API/slashCommand
function slashCommand.convertLine(text)
  text = withCursor(text)
  local line = editor.getCurrentLine()
  local body = string.match(line.text, "^%s*(.-)%s*$")
  local at = string.find(text, "|^|", 1, true)
  text = string.sub(text, 1, at - 1) .. body .. string.sub(text, at)
  editor.replaceRange(line.from, line.to, text .. separatorAfter(line), true)
end
```
