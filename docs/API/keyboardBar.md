---
tags: api/space-lua maturity/experimental
references:
- libraries/Library/Std/APIs/Keyboard Bar.md
- libraries/Library/Std/Config.md
- client/components/keyboard_bar.tsx
---

APIs to add buttons to the keyboard bar.

On phones and tablets, the keyboard bar shows editing shortcuts above the on-screen keyboard (or along the bottom of the screen with a hardware keyboard). Its buttons come from the `keyboardBar` option in [[^Library/Std/Config]]: replace the whole list with `config.set`, or add to it with `keyboardBar.define`. Buttons can be limited to where the cursor is, so e.g. the indent and outdent buttons only appear inside outlines.

The bar is on by default. **Editor: Toggle Keyboard Bar** turns it off or on again; the choice is remembered per device. Setting `keyboardBar` to an empty list hides it everywhere.

> **success** Success
> Put your `keyboardBar.define` calls in your [[CONFIG]] page.

# API
## keyboardBar.define(spec)
Appends a button to the bar. `spec` is a table that can contain:
* `icon` (required): [feather icon](https://feathericons.com) name (bare or `feather:`-prefixed), one of the `md-*` editor icons (e.g. `md-format-bold`), or literal `<svg>` markup
* `command`: command name to run when tapped. Replaces `run`.
* `run`: function to run when tapped
* `description`: accessible label of the button
* `onlyContexts`: only show the button while the cursor is inside one of these syntax nodes, e.g. `{"ListItem"}` for outlines or `{"FencedCode:lua"}` for Lua code blocks
* `exceptContexts`: hide the button while the cursor is inside one of these syntax nodes

Contexts match by prefix against the syntax nodes enclosing the cursor, the same way as `onlyContexts`/`exceptContexts` for [[API/slashCommand|slash commands]]. Useful ones are `ListItem`, `Task`, `FencedCode`, `FrontMatter`, `Table`, `Blockquote` and `ATXHeading1`–`ATXHeading6`.

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
