---
description: "A /-triggered shortcut in the editor for inserting content or running actions."
tags: glossary
---
Slash commands are quick ways to perform repetitive tasks. You trigger them by typing `/` in your text (after whitespace) followed by the command name — autocompletion will help you find the right one.

# Built-in slash commands
[[^Library/Std#Slash templates]] provides many useful ones out of the box.

**Editing**
* `/h1`, `/h2`, `/h3`, `/h4` — convert the current line into a heading of the given level
* `/task` — convert the current line into a task (`* [ ] ...`)
* `/frontmatter` — insert a YAML frontmatter block at the top of the page
* `/space-lua` — insert a `space-lua` fenced code block

**Dates**
* `/today` — insert today's date (e.g. `2026-03-04`)
* `/yesterday` — insert yesterday's date
* `/tomorrow` — insert tomorrow's date

# Slash templates
Most slash commands are implemented as [[Slash Templates]] — pages tagged with `#meta/template/slash` whose content is inserted at the cursor. The standard library includes slash templates for:

* `/query` — insert a LIQ query block
* `/lua-query` — insert a Lua query expression
* `/code` — insert a fenced code block
* `/table` — insert a Markdown table
* `/hr` — insert a horizontal rule
* `/note-admonition`, `/warning-admonition`, `/success-admonition`, `/danger-admonition` — insert admonition blocks
* `/tpl` — insert a template expression
* `/func` — insert a Lua function definition
* `/lua-command` — insert a command definition
* `/lua-slash-command` — insert a slash command definition

# Defining your own
There are two ways to create custom slash commands:

1. **Slash templates** (recommended): Create a page tagged `#meta/template/slash`. See [[Slash Templates]] for details.
2. **`slashCommand.define`**: For slash commands that need logic beyond simple text insertion. See [[API/command#slashCommand.define(spec)]].
