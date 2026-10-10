---
description: The inline rendering of Markdown formatting as you type.
tags: glossary
references:
- client/markdown_renderer/markdown_render.ts
---
SilverBullet uses a “live preview” markdown editor. This mechanism is heavily inspired by [Obsidian's live preview mode](https://obsidian.md/help/edit-and-read#Live+Preview).

It reduces visual noise by not constantly showing [[Markdown]] formatting codes such as `[SilverBullet website](https://silverbullet.md)`, only showing the underlying Markdown formatting when the cursor is placed inside.

# Revealing the source
In SilverBullet, you can always see the underlying format by moving your cursor "inside" any formatted element with the keyboard, or by **Alt-clicking** (or Option-clicking on Mac) on any piece of formatted text.

# Toggling live preview
If you prefer to see the raw markdown at all times, run the ${widgets.commandButton("Editor: Toggle Markdown Syntax Rendering")} command. This switches between live preview mode and raw markdown mode.

# Widget rendering
[[Space Lua#Expressions]] (`${...}`) are rendered inline in place. The underlying code is hidden until you move your cursor into the expression. This is what makes SilverBullet pages feel dynamic — queries, templates, and widgets all render seamlessly within the document. A plain expression runs once when the page opens; wrap its value in [[API/widget#widget.live(value, refreshOn?)|widget.live]] to re-run it when the index changes, and use the ⋯ menu on a block widget to reload, copy or bake it.
