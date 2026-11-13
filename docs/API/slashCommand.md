---
tags: api/space-lua
references:
- libraries/Library/Std/APIs/Command.md
- client/plugos/hooks/slash_command.ts
- plug-api/types/manifest.ts
---
Define [[Slash Command|slash commands]]. For reusable text snippets, use [[Slash Templates]] instead.

## slashCommand.define(spec)
Define a custom slash command.

Supported keys in the spec:

* `name`: name of the command: what you type after `/`
* `displayName`: the label shown in the menu instead of `name`, e.g. `Heading 1` for `h1`. Typing the name keeps working.
* `description`: Description of the command
* `icon`: the icon shown in front of it: a [Feather](https://feathericons.com) icon name, an `md-*` editor icon (as on the [[API/markupBar|markup bar]]) or inline `<svg>` markup
* `aliases`: more words that find the command when typed after `/`, e.g. `{"heading", "title"}`
* `group`: the menu section it’s listed under, see [[#Groups]]
* `priority`: higher sorts earlier within its group
* `onlyContexts`, `exceptContexts`: only offer it in, or never in, these contexts: syntax node names such as `FencedCode`, `FrontMatter`, `ListItem` or `ATXHeading` (matched by prefix), and `@blank` (the line is empty apart from the typed `/`), `@hasChildren`, `@folded` and `@hasFrontmatter` (see [[API/markupBar]])
* `run`: The callback function that will be invoked once the command is run. The typed `/name` is removed first.

Example:

```space-lua
slashCommand.define {
  name = "hello-world",
  run = function()
    editor.insertAtCursor("Hello |^| world!", false, true)
  end
}
```

## Groups
With nothing typed after `/`, the menu lists its commands by group, under a header per group, in this order: `Basic blocks`, `Lists`, `Callouts`, `Media`, `Insert`, `Dates`, `Other`, `Advanced`, `Space Lua`. Within a group, higher `priority` comes first, then the label alphabetically. Commands without a `group` are listed under `Other`; a group not in this list comes just before `Other`.

Once you type, the menu shows the best matches first (on name, display name and aliases), without headers.

## slashCommand.insertBlock(text)
Inserts `text` as a block of its own where the slash command ran: in place of an empty line, or after the current line (with a blank line between) when that has text. `|^|` in `text` places the cursor. Use it for blocks like code fences or tables, which shouldn’t land mid-sentence.

## slashCommand.convertLine(text)
Turns the current line into `text`: the line’s text goes where `|^|` is, and the cursor after it. Used by the callouts: `/note-admonition` on `Remember this` gives a note callout with `Remember this` as its body.

Example:

```lua
slashCommand.define {
  name = "aside",
  displayName = "Aside",
  icon = "message-circle",
  group = "Callouts",
  run = function()
    slashCommand.convertLine("> **note** Aside\n> |^|")
  end
}
```
