---
description: APIs to add buttons to the keyboard bar
tags: meta/api
---

On phones and tablets, the keyboard bar shows editing shortcuts above the on-screen keyboard (or along the bottom of the screen with a hardware keyboard). Its buttons come from the `keyboardBar` option in [[^Library/Std/Config]]: replace the whole list with `config.set`, or add to it with `keyboardBar.define`. Buttons can be limited to where the cursor is, so e.g. the indent and outdent buttons only appear inside outlines.

The bar is on by default. **Editor: Toggle Keyboard Bar** turns it off or on again; the choice is remembered per device.

# API
## keyboardBar.define(spec)
Appends a button to the bar. Keys:

* `icon`: [feather icon](https://feathericons.com) name (bare or `feather:`-prefixed), one of the `md-*` editor icons (e.g. `md-format-bold`), or literal `<svg>` markup
* `command` (optional): command name to run when tapped. Replaces `run`.
* `run` (optional): function to run when tapped
* `description` (optional): accessible label of the button
* `onlyContexts` (optional): only show the button while the cursor is inside one of these syntax nodes, e.g. `{"ListItem"}` for outlines or `{"FencedCode:lua"}` for Lua code blocks
* `exceptContexts` (optional): hide the button while the cursor is inside one of these syntax nodes

Contexts match by prefix against the syntax nodes enclosing the cursor, the same way as `onlyContexts`/`exceptContexts` for slash commands. Useful ones are `ListItem`, `Task`, `FencedCode`, `FrontMatter`, `Table`, `Blockquote` and `ATXHeading1`–`ATXHeading6`.

# Examples
```lua
-- A strikethrough button everywhere but in code
keyboardBar.define {
  icon = "md-format-strikethrough",
  description = "Strikethrough",
  command = "Text: Strikethrough",
  exceptContexts = {"FencedCode"},
}

-- Fold the current outline item, only offered inside outlines
keyboardBar.define {
  icon = "chevrons-up",
  description = "Toggle fold",
  command = "Outline: Toggle Fold",
  onlyContexts = {"ListItem"},
}

-- Replace the default buttons altogether
config.set("keyboardBar", {
  { icon = "md-format-bold", command = "Text: Bold" },
  { icon = "rotate-ccw", command = "Editor: Undo" },
})
```

# Implementation
```space-lua
-- priority: 100

keyboardBar = keyboardBar or {}

function keyboardBar.define(spec)
  local buttons = config.get("keyboardBar", {})
  table.insert(buttons, spec)
end
```
