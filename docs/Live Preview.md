---
description: The inline rendering of Markdown formatting as you type.
tags: glossary
references:
- client/markdown_renderer/markdown_render.ts
---
SilverBullet uses a “live preview” markdown editor. This mechanism is heavily inspired by [Obsidian’s live preview mode](https://obsidian.md/help/edit-and-read#Live+Preview).

The editor displays [[Markdown]] as formatted text. For example, `[SilverBullet website](https://silverbullet.md)` appears as a clickable link until you reveal its source.

# Revealing the source
On an editable page, moving the cursor inside a formatted element reveals its source. **Alt-click** (or **Option-click** on Mac) explicitly reveals source in both editable and read-only pages.

In a read-only page, ordinary keyboard navigation keeps links and widgets rendered. Alt/Option-click to reveal source, then select and copy it. The source stays visible while the selection touches its range. Moving entirely outside it hides the source again. Read-only access does not allow you to change the page.

# Toggling live preview
If you prefer to see the raw markdown at all times, run the ${widgets.commandButton("Editor: Toggle Markdown Syntax Rendering")} command. This switches between live preview mode and raw markdown mode.

# Widget rendering
[[Space Lua#Expressions]] (`${...}`) are rendered inline in place. The underlying code follows the source-reveal rules above. Queries, templates and widgets display their results within the document. An expression re-runs when something it read changes. See [[API/widget#When expressions update]]. Use a block widget's menu (the ⋮ beside it on desktop, its ⋯ on touch devices) to edit, copy, bake, move or delete it.
