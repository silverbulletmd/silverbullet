---
description: "A /-triggered shortcut in the editor for inserting content or running actions."
tags: glossary
references:
- client/plugos/hooks/slash_command.ts
- libraries/Library/Std/APIs/Command.md
---
Slash commands are quick ways to perform repetitive tasks. You trigger them by typing `/` in your text (after whitespace) followed by the command name — autocompletion will help you find the right one.

# The slash menu
Type `/` on an empty line to see what you can add, grouped under headers: **Basic blocks**, **Lists**, **Callouts**, **Media**, **Insert**, **Dates** and **Advanced**. Keep typing to filter: a command is found by its name (`/h1`), the label the menu shows (`/heading`) and its aliases (`/divider`). The ⋮ handle’s menu on an empty line lists the same blocks, one submenu per group.

On a line that already has text, a block converts that line (like the ⋮ menu’s “Turn into”): `/h2` makes it a heading, `/bullet` a list item, a callout puts the text in the callout. Blocks that can’t hold the line’s text, such as a code block, table or divider, go on their own line below it. The menu leaves out what doesn’t fit where you are: no headings or lists inside code or frontmatter, no headings or lists on a list item, and no **Page properties** on a page that has frontmatter already.

# Built-in slash commands
[[^Library/Std#Slash templates]] provides many useful ones out of the box. Each is shown by its label and found by its name too (in brackets).

**Basic blocks**
* Text (`/text`) — turn a heading, list item or quote back into plain text
* Heading 1–4 (`/h1`–`/h4`) — convert the current line into a heading
* Quote (`/quote`) — convert the current line into a quote
* Code block (`/code`), Table (`/table`), Divider (`/hr`) — insert a fenced code block, a Markdown table, a horizontal rule

**Lists**
* Bulleted list (`/bullet`), Numbered list (`/numbered`) — convert the current line into a list item
* Task (`/task`) — convert the current line into a task

**Callouts**
* Callout: note, warning, danger, success (`/note-admonition`, `/warning-admonition`, `/danger-admonition`, `/success-admonition`, or `/callout`)

**Media**
* Image or file (`/upload`) — upload a file and embed it
* Embed page (`/embed`) — type `![[` and pick the page to show inline

**Insert**
* Link to page (`/link`) — type `[[` and pick the page
* Tag (`/tag`) — type `#` and pick the tag
* Query… (`/Query…`) — build a query in the [[Workbench]] and insert it
* Page properties (`/frontmatter`) — insert a YAML frontmatter block at the top of the page
* Comment (`/comment`), Signature (`/sign`)

**Dates**
* Today (`/today`), Tomorrow (`/tomorrow`), Yesterday (`/yesterday`) — insert the date (e.g. `2026-03-04`); `/date` finds all three

**Advanced**
* Query (code) (`/query`) — insert a SLIQ query block
* Data block (`/data`) — insert a [[Tag/data|data block]], with the cursor where its tag goes
* Space Lua block (`/space-lua`) — insert a `space-lua` fenced code block

**Inside a `space-lua` block**
* `/lua-query` — insert a Lua query expression
* `/tpl` — insert a template expression
* `/func` — insert a Lua function definition
* `/lua-command`, `/lua-slash-command`, `/tag-schema` — insert a command, slash command or tag schema definition

# Slash templates
Most of the inserting slash commands are implemented as [[Slash Templates]]: pages tagged with `#meta/template/slash` whose content is inserted at the cursor.

# Defining your own
There are two ways to create custom slash commands:

1. **Slash templates** (recommended): Create a page tagged `#meta/template/slash`. See [[Slash Templates]] for details.
2. **`slashCommand.define`**: For slash commands that need logic beyond simple text insertion. See [[API/slashCommand#slashCommand.define(spec)]].

Both take a `displayName`, `icon`, `aliases` and `group` to fit into the menu like the built-in ones.
