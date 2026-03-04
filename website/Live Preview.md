---
description: The inline rendering of Markdown formatting as you type.
tags: glossary
---
SilverBullet uses a “live preview” markdown editor. This mechanism is heavily inspired by [Obsidian's live preview mode](https://help.obsidian.md/Live+preview+update).

It reduces visual noise by not constantly showing [[Markdown]] formatting codes such as `[SilverBullet website](https://silverbullet.md)`, only showing the underlying Markdown formatting when the cursor is placed inside.

# Revealing the source
In SilverBullet, you can always see the underlying format by moving your cursor "inside" any formatted element with the keyboard, or by **Alt-clicking** (or Option-clicking on Mac) on any piece of formatted text.

# Toggling live preview
If you prefer to see the raw markdown at all times, run the ${widgets.commandButton("Editor: Toggle Markdown Syntax Rendering")} command. This switches between live preview mode and raw markdown mode.

# Widget rendering
[[Space Lua#Expressions]] (`${...}`) are rendered inline as live widgets. The underlying code is hidden until you move your cursor into the expression. This is what makes SilverBullet pages feel dynamic — queries, templates, and widgets all render seamlessly within the document.
