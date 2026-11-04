---
description: "Choose the fonts for the interface, the editor and code, and add more with font libraries."
tags: customization
references:
- plug-api/lib/fonts.ts
- client/workbench/configuration/font_select.tsx
- libraries/Library/Std/Config.md
- client/codemirror/editing/list_indent.ts
---
SilverBullet uses three fonts, each picked separately in [[Workbench/Configuration]] under **Appearance**:

* **Interface font**: menus, panels, the page title and the [[Workbench]].
* **Editor font**: the text of your pages.
* **Code font**: anything code-like: inline code, [[Markdown/Fenced Code Block|code blocks]], frontmatter and tables while you edit them, and `${...}` expressions while the cursor is in them. It should be a monospace font.

Instead of using the [[Workbench/Configuration]] options, you can also set them in [[CONFIG]]:

```lua
config.set("fonts.editor", "inter")
config.set("fonts.ui", "system-sans")
config.set("fonts.code", "ia-writer-mono")
```

# Editor font size
**Editor font size**, also under **Appearance**, sets the size of page text in the editor, in pixels: 18 by default, from 10 to 48. Headings, code and list indents scale with it. A proportional font often looks smaller than a monospace one at the same size, so you may want to raise it after switching. In [[CONFIG]]:

```lua
config.set("fonts.editorSize", 20)
```

# Built-in fonts
These come with SilverBullet, or with your operating system, and work offline:

* **iA Writer Mono** (`ia-writer-mono`): the default for all three.
* **Inter** (`inter`): a clear sans for the interface and the editor.
* **System sans**, **System serif** and **System mono** (`system-sans`, `system-serif`, `system-mono`): your operating system's own fonts, such as San Francisco on Apple devices and Segoe UI on Windows.

# The default font
When a space doesn’t pick an interface or editor font, it uses the default font: in SilverBullet Server, the **Default font** in the dashboard's Server settings; in SilverBullet Desktop, **Font** under Advanced. The default font also sets the dashboard and sign-in pages.

# Font libraries
Additional fonts can be distributed as [[Library|libraries]]. If you uninstall a font library while a space still uses its font, the interface and editor fall back to the default font.

## Writing a font library
A font library is an ordinary [[Library]]: a page that adds its font to `fonts.available`, with the font files listed under `files` in its frontmatter so they're installed with it.

```lua
config.set("fonts.available.literata", {
  name = "Literata",                   -- shown in Configuration
  family = "Literata, Georgia, serif", -- the CSS font-family, with fallbacks
  kind = "serif",                      -- sans, serif or mono
  faces = {
    { src = "Library/myuser/Fonts/Literata/Literata-Variable.ttf", weight = 400 },
    { src = "Library/myuser/Fonts/Literata/Literata-Variable.ttf", weight = 700 },
    { src = "Library/myuser/Fonts/Literata/Literata-Italic-Variable.ttf", weight = 400, style = "italic" },
    { src = "Library/myuser/Fonts/Literata/Literata-Italic-Variable.ttf", weight = 700, style = "italic" },
  },
  license = "OFL-1.1",
})
```

Each face is a font file in your space: `.woff2`, `.woff`, `.ttf` or `.otf`. A variable font covers every weight in one file. Keep file and folder names free of spaces and brackets, because library files are fetched by URL.

# Indent width
With a proportional font, one step of list nesting is the width of a `0` in the editor font. A [[Space Style]] can widen it:

```css
html {
  --editor-column-width: 0.8em;
}
```

# Notes for theme authors
If your [[Space Style]] sets fonts, a few things changed with this feature:

* **Code no longer follows `--editor-font`.** It uses `--editor-monospace-font`. A theme that set `--editor-font` to a monospace font, and expected code to follow, should set `--editor-monospace-font` too.
* **The editor's text size is the `--editor-font-size` variable** (18px in the theme), no longer a fixed `font-size` on `#sb-main .cm-editor`.
* **A `space-style` that sets `--editor-font`, `--ui-font`, `--editor-monospace-font` or `--editor-font-size` wins over the Configuration setting**, whether it sets them on `html` or `:root`. Remove it from your style to pick fonts in Configuration instead.
* **Numbered lists right-align their numbers** to the widest number in the list, so items `9.` and `10.` start their text in the same place.