---
description: "Choose the fonts for the editor and code, and add more with font libraries."
tags: customization
references:
- plug-api/lib/fonts.ts
- client/workbench/configuration/font_select.tsx
- libraries/Library/Std/Config.md
- client/codemirror/editing/list_indent.ts
---
The interface (menus, panels, the page title and the [[Workbench]]) uses the theme's interface font. The fonts for your writing are yours to pick, separately, in [[Workbench/Configuration]] under **Appearance**:

* **Editor font**: the text of your pages.
* **Code font**: anything code-like: inline code, [[Markdown/Fenced Code Block|code blocks]], frontmatter and tables while you edit them, and `${...}` expressions while the cursor is in them. It should be a monospace font.

Instead of using the [[Workbench/Configuration]] options, you can also set them in [[^Library/Config]]:

```space-lua
config.set("fonts.editor", "inter")
config.set("fonts.code", "ia-writer-mono")
```

# Editor font size
**Editor font size**, also under **Appearance**, sets the size of page text in the editor, in pixels. Headings, code and list indents scale with it.

In [[^Library/Config]]:

```space-lua
config.set("fonts.editorSize", 20)
```

Code follows the editor font automatically: SilverBullet measures the editor font's x-height (the height of a lowercase letter) and scales code to match it.

# Font libraries
Additional fonts can be distributed as [[Library|libraries]]. If you uninstall a font library while a space still uses its font, the editor falls back to the theme’s suggested font, or else iA Writer Mono.

## Writing a font library
A font library is an ordinary [[Library]]: a page that adds its font to `fonts.available`, with the font files listed under `files` in its frontmatter so they're installed with it.

```space-lua
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
Bullets, task checkboxes and list nesting are laid out on a grid of columns. With a monospace editor font a column is one character wide; with a proportional one it is three quarters of the width of a `0`, so markers sit close to their text. A [[Space Style]] can change it:

```css
html {
  --editor-column-width: 0.8em;
}
```

# Notes for theme authors
A [[Theming|theme]] suggests fonts with the `fonts` key in its frontmatter (`ui`, `editor`, `code` and `editorSize`, with the same font keys as above). The interface font is the theme's alone: a space can't override it, and doesn't set font variables itself. A space's own choice in Configuration or [[^Library/Config]] always wins, and the suggestion applies only to what the space leaves unset. SilverBullet warns when a theme's `space-style` sets `--ui-font`, `--editor-font`, `--editor-monospace-font` or `--editor-font-size`.

```yaml
tags: meta/theme
scheme: light
fonts:
  editor: inter
  editorSize: 20
```

A theme that relies on a font from a font library requires that library (`requires:`), so installing the theme installs the font too. See [[Theming/Creating a Theme#Sharing a theme|Sharing a theme]].

If your [[Space Style]] sets fonts, a few things changed with this feature:

* **Code no longer follows `--editor-font`.** It uses `--editor-monospace-font`. A theme that set `--editor-font` to a monospace font, and expected code to follow, should set `--editor-monospace-font` too.
* **The editor's text size is the `--editor-font-size` variable** (18px in the theme), no longer a fixed `font-size` on `#sb-main .cm-editor`.
* **A `space-style` that sets `--editor-font`, `--ui-font`, `--editor-monospace-font` or `--editor-font-size` wins over the Configuration setting**, whether it sets them on `html` or `:root`. Remove it from your style to pick fonts in Configuration instead.
* **Numbered lists right-align their numbers** to the widest number in the list, so items `9.` and `10.` start their text in the same place.