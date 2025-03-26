#meta

Some convenient slash commands for editing Markdown files.

```space-lua
local function headerSlashCommand(level)
  local line = editor.getCurrentLine()
  local cleanText = string.gsub(line.textWithCursor, "^#+%s*", "")
  editor.replaceRange(line.from, line.to,
    string.rep("#", level) .. " " .. cleanText, true)
end

slashcommand.define {
  name = "h1",
  run = function()
    headerSlashCommand(1)
  end
}

slashcommand.define {
  name = "h2",
  run = function()
    headerSlashCommand(2)
  end
}

slashcommand.define {
  name = "h3",
  run = function()
    headerSlashCommand(3)
  end
}

slashcommand.define {
  name = "h4",
  run = function()
    headerSlashCommand(4)
  end
}

slashcommand.define {
  name = "frontmatter",
  run = function()
    editor.insertAtPos([==[---
|^|
---
]==], 0, true)
  end
}

slashcommand.define {
  name = "task",
  run = function()
    local line = editor.getCurrentLine()
    local ws, prefix, rest = string.match(line.textWithCursor, "^(%s*)([%-%*]?)%s*(.+)$")
    editor.replaceRange(line.from, line.to, ws .. "* [ ] " .. rest, true)
  end
}
```
