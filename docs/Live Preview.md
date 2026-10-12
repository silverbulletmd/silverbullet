---
description: The inline rendering of Markdown formatting as you type.
tags: glossary
references:
- client/markdown_renderer/markdown_render.ts
---
SilverBullet uses a “live preview” markdown editor. This mechanism is heavily inspired by [Obsidian's live preview mode](https://obsidian.md/help/edit-and-read#Live+Preview).

It reduces visual noise by not constantly showing [[Markdown]] formatting codes such as `[SilverBullet website](https://silverbullet.md)`, only showing the underlying Markdown formatting when the cursor is placed inside.

# Revealing the source
In SilverBullet, you can always see the underlying format by moving your cursor “inside” any formatted element with the keyboard, or by **Alt-clicking** (or Option-clicking on Mac) on any piece of “previewing” text.

# Toggling live preview
If you prefer to see the raw markdown at all times, run the ${widgets.commandButton("Editor: Toggle Markdown Syntax Rendering")} command. This switches between live preview mode and raw markdown mode.

# Widget rendering
[[Space Lua#Expressions]] (`${...}`) are rendered inline in place. The underlying code is hidden until you move your cursor into the expression. This is what makes SilverBullet pages feel dynamic — queries, templates, and widgets all render seamlessly within the document. An expression re-runs when something it read changes; see [[API/widget#When expressions update]]. Use the ⋯ menu on a block widget to reload, copy or bake it.
