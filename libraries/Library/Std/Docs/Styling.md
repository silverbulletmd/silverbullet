---
description: Themes and CSS styling of a space, from picking its theme and writing a theme page (meta/theme) to space-style blocks, theme variables, light and dark, and fonts. Read before choosing or writing a theme, writing or changing a space-style block, changing fonts, or checking how a space looks in dark mode. Not needed to attach a class to a widget or a tag (Building Interfaces covers that).
tags: meta/skill
---
A **theme** is a page under `Library/` tagged `meta/theme`. It sets the colors and whether the space is light or dark; dark mode is a dark theme being active. SilverBullet ships two: `Library/Std/Themes/SilverBullet Light` and `Library/Std/Themes/SilverBullet Dark`. Ordinary styling is CSS in `space-style` blocks on any other page under `Library/` (blocks elsewhere do not apply), on top of whichever theme is active. A `write` or `edit` of a page with `space-style` blocks reloads them and reports lint problems; after `space.writePage` from `lua`, call `system.reboot()`.

# Pick the route
* **A new look as a whole** (palette, a light and dark pair): write a theme, see Writing a theme.
* **Use an installed theme:** set the space's `theme` setting, see Picking a theme.
* **Adjust colors, widths or elements whatever the theme:** a `space-style` block on an ordinary page such as `Library/Style`, see Customizing on top of a theme.
* **Fonts:** configuration, not CSS, see Fonts.

# Steps
1. **Read the theme.** `theme.getActive()` names it; list its variables (snippet under Variables). Most colors are a variable away: set the variable before reaching for a selector.
2. **Inspect each element you will style** before writing CSS for it: its classes, computed styles and parent chain (snippet under Inspecting an element). Inherited fonts, negative margins and wrapper classes show up here, and only by accident in a screenshot.
3. **Write the block** or the theme page, with the variables and selectors below.
4. **Check it.** The `write`/`edit` result lists lint problems (theme frontmatter included); fix them. `read` the page with `rendered: true`, take a `screenshot` in a light and in a dark theme (see Checking light and dark), and run the inspection snippet again on every element you targeted.

Done when the write result is clean, both screenshots look right, every targeted element's computed styles show your values, every editor line you gave vertical spacing (headings, `.cm-line`) shows `margin: 0px` with the spacing in its padding (see Editor specifics), and `theme.getDeviceTheme()` is back to what it was before you started.

# Picking a theme
SilverBullet shows the first of these that names an installed theme:
1. **This device's choice**: `theme.setDeviceTheme(page)`, or `nil` to clear it. `theme.getDeviceTheme()` reads it. It is stored per client, and the `lua` runtime's client may be the user's own: on SilverBullet Desktop it shares the editor's storage, so a switch from `lua` changes the user's device theme for that space. Before switching, record `theme.getDeviceTheme()`, and afterwards restore exactly that value.
2. **The space's `theme` setting**, for every device: `config.persist("theme", "Library/Std/Themes/SilverBullet Dark")` with `lua`, which writes it into the managed block of `Library/Config` (the one Configuration → Appearance → Theme edits). Change it only when the user asks for a different theme.
3. SilverBullet Light, or SilverBullet Dark when the system prefers dark.

`theme.list()` returns the installed themes, each with `page`, `displayName`, `scheme` (`light` or `dark`) and, when set, `description`, `counterpart` and `fonts`. A theme is identified by its page name; one renamed or removed is skipped.

# Writing a theme
````markdown
---
tags: meta/theme
displayName: Sepia
description: Warm paper with brown ink.
scheme: light
fonts:
  editor: inter
---
```space-style
html {
  --root-background-color: #f6efe2;
  --root-color: #3b3024;
  --subtle-color: #8a7a66;
  --ui-surface-border-color: #e0d4bf;
  --ui-accent-color: #a8432f;
  --link-color: #8c3b2a;
}
```
````

* **Place it** under `Library/`, for example `Library/Themes/Sepia`. The page name is the theme's identity: the space setting and device choices store it, so renaming it resets them.
* **Frontmatter:** `scheme` (`light` or `dark`) is required: without a valid one the page is not a theme, it is missing from `theme.list()`, and its `space-style` blocks apply nowhere (its `space-lua` still runs). The lint error on `scheme` is the only signal. `displayName` and `description` show in pickers. `counterpart` is a quoted wiki link to its light or dark sibling, such as `counterpart: "[[Library/Themes/Sepia Night]]"`, which **Theme: Toggle Light/Dark** switches to; the sibling is its own theme page with its own `scheme` and a `counterpart` pointing back. `fonts` suggests fonts (see Fonts). The tag has a schema, so a wrong `scheme` or a `fonts.editorSize` outside 10 to 48 is a lint problem in the write result.
* **Every `space-style` block on the page belongs to the theme** and applies only while it is active. A `space-lua` block on it runs always, like on any `Library/` page.
* **Set base variables in a plain `html { … }` rule.** The theme starts from the built-in theme with the same `scheme` (SilverBullet Dark for a dark one), and SilverBullet's defaults have zero specificity, so `!important`, `:root` and `[data-sb-scheme]` selectors are never needed in a theme.
* **Prefix variables of your own** with the theme's name (`--sepia-ink`).
* **Strong accent:** hashtag pills and the selected completion fill with `--ui-accent-strong-color` and write on it in `--ui-accent-strong-contrast-color`, which assumes the fill comes out dark. With a very light accent, set both.

After the write, `theme.list()` includes it. Switch to it with `theme.setDeviceTheme(page)` to check it, and look at a page with a table, code, frontmatter and hashtags, the command palette and a notification: most derived colors show there.

# Variables
Themes and styles work by setting CSS custom properties on `html`. **Base variables** are the palette; nearly every other (**specific**) variable derives from them: the top bar mixes the page and subtle colors, alerts and notifications use the tones, hashtags and the selected completion use the strong accent. Set base variables first, and a specific one only when its derived color does not work.

The base variables:
* Surfaces and text: `--root-background-color`, `--root-color`, `--subtle-color`, `--subtle-background-color`, `--ui-surface-border-color`.
* Accent: `--ui-accent-color`, `--ui-accent-contrast-color`, `--ui-accent-strong-color`, `--ui-accent-strong-contrast-color`.
* Links and meta: `--link-color`, `--link-missing-color`, `--link-invalid-color`, `--meta-color`, `--meta-subtle-color`. Marks: `--highlight-color`.
* Tones: `--tone-<name>` and `--tone-<name>-soft` for `success`, `warning`, `danger`, `info`, `neutral` and `accent`. They are also for your own styles and widgets: every theme gives them values that read on its background, so color with `var(--tone-danger)` rather than a fixed color, which needs checking in a light and a dark theme.
* Code: `--editor-code-color` and `--editor-code-<part>-color` for `variable`, `typename`, `string`, `number`, `operator`, `atom`, `comment`.
* Layout: `--editor-width`. Fonts (set through configuration): `--ui-font`, `--editor-font`, `--editor-monospace-font`, `--editor-font-size`.

The derivations are computed on `html`, so set base variables there: a base variable set on another element (`#sb-top { --root-color: red }`) changes that element but not the specific variables computed from it. Every variable, with its light and dark values and what it derives from, is on the `Theming/Variables` page of the SilverBullet documentation (docs.silverbullet.md; edge.silverbullet.md for Edge builds), and the selectors SilverBullet keeps stable are on `Theming/Selectors`. Any other class, id or structure may change between releases.

This lists the active theme's variables whose name contains `filter` (`""` for all). A derived variable shows its formula with the base values filled in, such as `color-mix(in srgb, #3569b8, black 20%)`:

```lua
local filter = "accent"
local cs = js.window.getComputedStyle(js.window.document.documentElement)
local rows = {}
for i = 0, cs.length - 1 do
  local name = cs.item(i)
  if string.sub(name, 1, 2) == "--" and string.find(name, filter, 1, true) then
    rows[#rows + 1] = name .. ": " .. cs.getPropertyValue(name)
  end
end
table.sort(rows)
return theme.getActive().page .. "\n" .. table.concat(rows, "\n")
```

To compare with another theme, switch to it with `theme.setDeviceTheme(page)` first, and restore the device theme afterwards (see Checking light and dark).

# Customizing on top of a theme
Ordinary `space-style` blocks load after the theme, so a rule there beats the theme's rule for the same selector (or one as specific), whatever its `/* priority: N */` (priority orders ordinary blocks among themselves: highest first, so a lower priority loads later and wins ties). Target a rule at:

```css
/* Every theme */
html {
  --editor-width: 1000px;
}

/* Light or dark themes: data-sb-scheme is "light" or "dark" */
html[data-sb-scheme="dark"] {
  --highlight-color: rgba(255, 200, 0, 0.35);
}

/* One theme, by the end of its page name */
html[data-sb-theme$="/Sepia"] {
  --link-color: #8c3b2a;
}
```

A color in a plain `html` rule applies in dark themes too, so give every color you set a `html[data-sb-scheme="dark"]` value as well, or use a tone or another variable (`var(--tone-accent)`) that each theme already sets. Read `data-sb-scheme` and `data-sb-theme` in selectors and scripts; SilverBullet sets them from the active theme, so switch themes with the theme API rather than setting them. `data-theme` is a deprecated alias of `data-sb-scheme`.

A look with a palette of its own is a theme, not a stack of overrides: write one instead.

# Fonts
Fonts are configuration: `config.persist("fonts.editor", "inter")` with `lua` (it writes the managed block of `Library/Config`, like Configuration → Appearance), with the keys `ui` (interface), `editor` (page text), `code` (monospace) and `editorSize` (pixels, 10 to 48). `table.keys(config.get("fonts.available"))` lists the installed font keys; more come from font libraries. A theme only suggests fonts, with the same keys under `fonts` in its frontmatter; the space's own setting wins. Keep `--ui-font`, `--editor-font`, `--editor-monospace-font` and `--editor-font-size` out of CSS: theme and ordinary styles both load after the configured fonts, so setting them overrides the configuration (in a theme, with a lint warning).

# Checking light and dark
1. Record `theme.getDeviceTheme()` (a page name, or `nil`) and `theme.getActive()`.
2. Switch to a dark theme: `theme.setDeviceTheme("Library/Std/Themes/SilverBullet Dark")`, the active theme's `counterpart`, or the theme you are writing. Take a `screenshot`.
3. Switch to a light theme the same way and take the second screenshot.
4. Restore exactly what step 1 recorded: `theme.setDeviceTheme(recorded)`, which is `theme.setDeviceTheme(nil)` only when it was `nil`. On SilverBullet Desktop this is the user's own device theme.

# Inspecting an element
Run with `lua` on the page that shows the element (an empty result means nothing matched); change the selector:

```lua
local el = js.window.document.querySelector(".sb-wiki-link")
local out = {}
while el and #out < 6 do
  local cs = js.window.getComputedStyle(el)
  out[#out + 1] = el.tagName .. " ." .. tostring(el.className) .. " | font: " .. cs.fontFamily .. " | margin: " .. cs.margin .. " | padding: " .. cs.padding
  el = el.parentElement
end
return table.concat(out, "\n")
```

Add other properties (`cs.color`, `cs.backgroundColor`, `cs.lineHeight`) as needed; these come out resolved, unlike variables. `document.elementFromPoint(x, y)` finds what sits at a spot in a screenshot.

# Editor specifics
* **Space editor lines with padding.** The editor works out which line a click hits from line heights, and margins are not part of a line's height, so vertical margin on a heading (`.sb-line-h1` to `.sb-line-h6`) or any `.cm-line` sends clicks below it to the wrong line, more so further down the page. `padding-top` and `padding-bottom` give the same look and keep clicks exact.
* **Scope editor rules** with `#sb-main .cm-editor` so they do not leak into panels and widgets.
* **Links carry negative side margins.** `.sb-wiki-link` (and `a.wiki-link` in rendered Markdown) has `padding: 0 5px; margin: 0 -5px` to widen its background without moving text. A link styled as a tile or button needs its own `margin`, set with a selector at least as specific.
* **Code blocks set the monospace font.** `.sb-line-fenced-code`, `.sb-line-code`, `.sb-frontmatter` and `.sb-code` use `--editor-monospace-font`, and a widget rendered from a fenced code block sits inside such a line and inherits it. Give the widget's own root class a `font-family` (`var(--editor-font)` for the body text font).
* **List items contain an invisible character.** Each list item has a `span.sb-word-joiner` holding U+2060. A font without that glyph draws a box: keep a fallback in every font stack (`"Lato", system-ui, sans-serif`), or set `.sb-word-joiner { font-family: system-ui; }`.
