Some convenient slash commands for editing Markdown files: the slash menu's basic blocks, lists, media and links. Each keeps its short `name` (what you type, like `/h1`) and shows a `displayName` (like “Heading 1”) in the menu.

```space-lua
-- priority: 10

-- Where prose blocks make sense: not in code, frontmatter or a Lua directive
local prose = {"FencedCode", "FrontMatter", "LuaDirective"}

-- `prose` plus the `extra` contexts
local function except(extra)
  local contexts = {}
  for _, context in ipairs(prose) do
    table.insert(contexts, context)
  end
  for _, context in ipairs(extra) do
    table.insert(contexts, context)
  end
  return contexts
end

-- Runs a "turn into" command on the current line; on what was an empty line,
-- the cursor ends up after the new markup, ready to type. Trailing whitespace
-- (the space typed before the `/`) goes first.
local function turnInto(commandName)
  local before = editor.getCurrentLine()
  local trimmed = string.gsub(before.text, "%s+$", "")
  if string.find(trimmed, "%S") and trimmed ~= before.text then
    editor.replaceRange(before.from + #trimmed, before.to, "")
  end
  editor.invokeCommand(commandName)
  if not string.find(before.text, "%S") then
    editor.moveCursor(editor.getCurrentLine().to)
  end
end

-- Strips quote, heading, task, bullet and number markers from the line start
local function stripBlockMarkup(text)
  local previous
  repeat
    previous = text
    text = string.gsub(text, "^%s*>%s?", "")
    text = string.gsub(text, "^%s*#+%s+", "")
    text = string.gsub(text, "^%s*[%-%*%+]%s+%[[^%]]*%]%s+", "")
    text = string.gsub(text, "^%s*[%-%*%+]%s+", "")
    text = string.gsub(text, "^%s*%d+[%.%)]%s+", "")
  until text == previous
  return text
end

-- Basic blocks

slashCommand.define {
  name = "text",
  displayName = "Text",
  description = "Turn back into plain text",
  icon = "type",
  aliases = {"normal", "paragraph", "plain"},
  group = "Basic blocks",
  priority = 100,
  onlyContexts = {"ATXHeading", "ListItem", "Blockquote"},
  exceptContexts = except({"@blank"}),
  run = function()
    local line = editor.getCurrentLine()
    -- Without the space typed before the `/`, at the end of the line
    local text = string.gsub(stripBlockMarkup(line.textWithCursor),
      "%s+(|%^|)$", "%1")
    editor.replaceRange(line.from, line.to, text, true)
  end
}

local headingDescriptions = {
  "Big section heading",
  "Medium section heading",
  "Small section heading",
  "Smallest section heading",
}

for level = 1, 4 do
  slashCommand.define {
    name = "h" .. level,
    displayName = "Heading " .. level,
    description = headingDescriptions[level],
    icon = "md-format-size",
    aliases = {"heading", "heading" .. level},
    group = "Basic blocks",
    priority = 95 - level,
    -- A list item stays one: `## - item` would be neither
    exceptContexts = except({"ListItem"}),
    run = function()
      turnInto("Text: Heading " .. level)
    end
  }
end

slashCommand.define {
  name = "quote",
  displayName = "Quote",
  description = "Capture a quote",
  icon = "md-format-quote",
  aliases = {"blockquote"},
  group = "Basic blocks",
  priority = 80,
  exceptContexts = except({"ListItem", "Blockquote"}),
  run = function()
    turnInto("Text: Quote Selection")
  end
}

-- Lists

slashCommand.define {
  name = "bullet",
  displayName = "Bulleted list",
  description = "A simple bulleted list",
  icon = "md-format-list-bulleted",
  aliases = {"list", "ul", "-"},
  group = "Lists",
  priority = 30,
  exceptContexts = except({"ListItem"}),
  run = function()
    turnInto("Text: Listify Selection")
  end
}

slashCommand.define {
  name = "numbered",
  displayName = "Numbered list",
  description = "A list with numbering",
  icon = "md-format-list-numbered",
  aliases = {"list", "ol", "number"},
  group = "Lists",
  priority = 20,
  exceptContexts = except({"ListItem"}),
  run = function()
    turnInto("Text: Number Listify Selection")
  end
}

slashCommand.define {
  name = "task",
  displayName = "To-do",
  description = "Track a task with a checkbox",
  icon = "md-checklist",
  aliases = {"todo", "checkbox"},
  group = "Lists",
  priority = 10,
  exceptContexts = except({"Task"}),
  run = function()
    turnInto("Text: Taskify Line")
  end
}

-- Media

slashCommand.define {
  name = "upload",
  displayName = "Image or file",
  description = "Upload a file and embed it here",
  icon = "paperclip",
  aliases = {"image", "file", "attachment"},
  group = "Media",
  priority = 20,
  exceptContexts = prose,
  run = function()
    editor.invokeCommand("File: Upload")
  end
}

slashCommand.define {
  name = "embed",
  displayName = "Embed page",
  description = "Show another page (or a section of it) inline",
  icon = "layers",
  aliases = {"transclude", "transclusion"},
  group = "Media",
  priority = 10,
  exceptContexts = prose,
  run = function()
    editor.insertAtCursor("![[|^|]]", false, true)
    editor.startCompletion()
  end
}

-- Insert

slashCommand.define {
  name = "link",
  displayName = "Link to page",
  description = "Link to another page",
  icon = "md-link",
  aliases = {"page", "wikilink"},
  group = "Insert",
  priority = 60,
  exceptContexts = prose,
  run = function()
    editor.invokeCommand("Text: Wiki Link")
  end
}

slashCommand.define {
  name = "tag",
  displayName = "Tag",
  description = "Tag this paragraph or item",
  icon = "hash",
  aliases = {"#", "hashtag"},
  group = "Insert",
  priority = 50,
  exceptContexts = prose,
  run = function()
    editor.insertAtCursor("#")
    editor.startCompletion()
  end
}

slashCommand.define {
  name = "frontmatter",
  displayName = "Page properties",
  description = "Add frontmatter to this page",
  icon = "sliders",
  aliases = {"properties", "props", "yaml"},
  group = "Insert",
  priority = 30,
  exceptContexts = except({"@hasFrontmatter"}),
  run = function()
    editor.insertAtPos([==[---
|^|
---
]==], 0, true)
  end
}

-- Advanced

slashCommand.define {
  name = "space-lua",
  displayName = "Space Lua block",
  description = "Insert Space Lua script",
  icon = "md-terminal",
  aliases = {"lua", "script"},
  group = "Advanced",
  priority = 10,
  exceptContexts = prose,
  run = function()
    slashCommand.insertBlock([==[```space-lua
|^|
```]==])
  end
}
```
