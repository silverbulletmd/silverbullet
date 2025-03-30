#meta

Some convenient slash commands for editing Markdown files.

```space-lua
-- priority: 10

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

slashcommand.define {
  name = "hr",
  run = function()
    editor.insertAtCursor("---\n")
  end
}

slashcommand.define {
  name = "note-admonition",
  run = function()
    editor.insertAtCursor([==[
> **note** Note
> |^|
]==], false, true)
  end
}

slashcommand.define {
  name = "warning-admonition",
  run = function()
    editor.insertAtCursor([==[
> **warning** Warning
> |^|
]==], false, true)
  end
}

slashcommand.define {
  name = "table",
  exceptContexts = {"FencedCode"},
  run = function()
    editor.insertAtCursor([==[
| Header A | Header B |
|----------|----------|
| Cell A|^| | Cell B |
]==], false, true)
  end
}

```
