---
tags: api/space-lua maturity/experimental
references:
- libraries/Library/Std/APIs/Markup Bar.md
- libraries/Library/Std/Config.md
- client/components/keyboard_bar.tsx
- client/lib/markup_buttons.ts
- client/lib/node_contexts.ts
---
The markup bar puts editing buttons in three places, each with its own list in [[^Library/Std/Config]], shown in list order:

* `markupBar.mobile`: on phones and tablets, the bar above the on-screen keyboard (or along the bottom of the screen with a hardware keyboard).
* `markupBar.selection`: on desktop, the formatting bubble over selected text.
* `markupBar.line`: on desktop, the menu behind the ⋮ handle that appears beside the line under the mouse.

Replace a whole list with `config.set`, or add to one with `markupBar.define`. Buttons can be limited to where the cursor is, so e.g. the indent and outdent buttons only appear inside outlines.

The markup bar is on by default. **Editor: Toggle Markup Bar** turns it off or on again. The choice is remembered per device.

# API
## markupBar.define(spec)
Appends a button to one surface's list. Keys:

* `surface` (required): where the button goes: `"mobile"` (the bar above the keyboard), `"selection"` (the desktop bubble over selected text) or `"line"` (the desktop ⋮ line menu). To put a button in more than one place, define it once per surface.
* `icon`: [feather icon](https://feathericons.com) name (bare or `feather:`-prefixed), one of the `md-*` editor icons (e.g. `md-format-bold`), or literal `<svg>` markup
* `command` (optional): command name to run when tapped. Replaces `run`.
* `run` (optional): function to run when tapped
* `description` (optional): accessible label of the button
* `onlyContexts` (optional): only show the button while the cursor (in the line menu: the start of the line's text) is inside one of these contexts, e.g. `{"ListItem"}` for outlines or `{"FencedCode:lua"}` for Lua code blocks
* `exceptContexts` (optional): hide the button while the cursor is inside one of these contexts
* `group` (optional, line menu only): buttons with the same `group` (e.g. `"Heading"`) share one submenu row labeled with it, in list order, where the first of them is.
* `activeContexts` (optional, line menu only): show the button ticked when the line is inside one of these contexts, e.g. `{"ATXHeading2"}` for **Heading 2**.

Contexts match by prefix against the syntax nodes enclosing the cursor, the same way as `onlyContexts`/`exceptContexts` for [[API/slashCommand|slash commands]]. Useful ones are `Paragraph`, `ListItem`, `Task`, `FencedCode`, `FrontMatter`, `Table`, `Blockquote` and `ATXHeading1`–`ATXHeading6`. Four more, starting with `@`, are facts about the line or page rather than syntax nodes: `@blank`, on an empty (or whitespace-only) line, `@hasChildren`, on a list item with nested items, `@folded`, on a line whose heading or item is folded (the default line menu uses it to offer **Expand** instead of **Collapse**), and `@hasFrontmatter`, anywhere on a page that has frontmatter. They work on every surface and for slash commands too, where `@blank` ignores the `/` you typed.

On desktop, the ⋮ line menu also builds two entries itself: **Add tag** at the top on line 1 of a page without frontmatter, and **Set state ▸** on a task, listing every known task state with the current one ticked. On a blank line it also lists the blocks the [[Slash Command|slash menu]] offers there, one submenu per group. **Editor: Toggle Markup Bar** also turns the bubble and the ⋮ menu's entries off on desktop, Set state included; **Add tag** stays.

Two options turn the desktop parts off for everyone using the space, also from the Editor section of the Configuration tab: `markupBar.selectionBubble` (default `true`) shows the formatting bubble over selected text, and `markupBar.lineHandle` (default `true`) shows the ⋮ line handle beside lines of text. Turning the handle off also removes its **Add tag** entry. They apply on top of **Editor: Toggle Markup Bar**: either one off hides the part. For example: `config.set("markupBar.lineHandle", false)`.

On desktop the ⋮ is also every widget's menu, in place of the ⋯ in its corner: it shows beside the top of a rendered `${...}` or query, a data block, an embed, a code widget, a baked section or a rendered table while the mouse is anywhere over it, with that widget's actions plus **Move up**, **Move down** and **Delete** for the whole block (a data block has a submenu per item). An inline `${...}` is a submenu of its paragraph's ⋮. These widget menus don't depend on `markupBar.lineHandle` or **Editor: Toggle Markup Bar**, and they also show in read-only spaces, with only the actions that don't edit. Phones and tablets keep the ⋯ on each widget, with the same menu.

## keyboardBar.define(spec)
The name from before the keyboard bar became the markup bar. It still works and does the same as `markupBar.define` with `surface = "mobile"`. Likewise a space that sets the old `keyboardBar` option gets that list on the bar above the keyboard instead of `markupBar.mobile`; the desktop lists are unaffected.

# Examples
```space-lua
-- A strikethrough button on the phone bar, everywhere but in code
markupBar.define {
  surface = "mobile",
  icon = "md-format-strikethrough",
  description = "Strikethrough",
  command = "Text: Strikethrough",
  exceptContexts = {"FencedCode"},
}

-- Fold the current outline item from the ⋮ menu, only offered inside outlines
markupBar.define {
  surface = "line",
  icon = "chevrons-up",
  description = "Toggle fold",
  command = "Outline: Toggle Fold",
  onlyContexts = {"ListItem"},
}

-- A button in the bubble over selected text on desktop
markupBar.define {
  surface = "selection",
  icon = "md-format-quote",
  description = "Quote",
  command = "Text: Quote Selection",
}

-- A "Callout" submenu in the ⋮ menu of a paragraph
markupBar.define {
  surface = "line",
  icon = "info",
  description = "Note",
  group = "Callout",
  onlyContexts = {"Paragraph"},
  run = function() editor.insertAtCursor("> **note** ") end,
}

-- Replace the phone bar's buttons altogether
config.set("markupBar.mobile", {
  { icon = "md-format-bold", command = "Text: Bold" },
  { icon = "rotate-ccw", command = "Editor: Undo" },
})
```
