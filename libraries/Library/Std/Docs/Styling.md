---
description: Theming a space with CSS in space-style blocks (colours, fonts, spacing), SilverBullet's theme variables, light and dark mode. Read before writing or changing a space-style block. Not needed to attach a class to a widget or a tag (Building Interfaces covers that).
tags: meta/skill
---
Styles are CSS in `space-style` fenced blocks, on a page under `Library/`; they do not apply from other pages. A dedicated page such as `Library/Theme` keeps them together. They apply to the whole space. A `write` or `edit` of that page reloads them; after `space.writePage` from `lua`, call `system.reboot()`.

# Steps
1. **Read the theme.** List the theme variables with their light and dark values (snippet below). Most colours and fonts are a variable away; set the variable before reaching for a selector.
2. **Inspect each element you will style**, before writing CSS for it: its classes, computed styles and parent chain (snippet below). Inherited fonts, negative margins and wrapper classes show up here, and only by accident in a screenshot.
3. **Write the block** with the variables and selectors below.
4. **Check it.** `read` the page with `rendered: true` for lint problems, take a `screenshot` in light and in dark mode (set `data-theme` as below), and run the inspection snippet again on every element you targeted.

Done when both screenshots look right, every targeted element's computed styles show your values, and every editor line you gave vertical spacing (headings, `.cm-line`) shows `margin: 0px` with the spacing in its padding (see Editor specifics).

# Theme variables
SilverBullet defines various CSS custom properties: `--ui-accent-color`, `--ui-font`, `--editor-font`, `--editor-monospace-font`, `--editor-font-size`, `--editor-wiki-link-page-color`, `--editor-table-head-background-color`, the tones `--tone-<name>` and `--tone-<name>-soft`, and more. Light values sit on `html`, dark values on `html[data-theme="dark"]`. This lists every one whose value differs between the themes, with both values (it switches the theme briefly and back):

```lua
local root = js.window.document.documentElement
local function vars()
  local cs, out = js.window.getComputedStyle(root), {}
  for i = 0, cs.length - 1 do
    local name = cs.item(i)
    if string.sub(name, 1, 2) == "--" then out[name] = cs.getPropertyValue(name) end
  end
  return out
end
local before = root.getAttribute("data-theme")
root.setAttribute("data-theme", "light")
local light = vars()
root.setAttribute("data-theme", "dark")
local dark = vars()
root.setAttribute("data-theme", before)
local rows = {}
for name, value in pairs(light) do
  if dark[name] ~= value then rows[#rows + 1] = name .. ": " .. value .. " | dark: " .. tostring(dark[name]) end
end
table.sort(rows)
return table.concat(rows, "\n")
```

Change the `if dark[name] ~= value` test to `if true` to list the variables both themes share as well.

# Light and dark
The client always sets `data-theme` on `<html>` to `light` or `dark`. Use the selectors SilverBullet itself uses, in a `space-style` block (shown here as plain CSS so this page stays inert):

```css
html {
  --ui-accent-color: #0071bc;
}
html[data-theme="dark"] {
  --ui-accent-color: #37a1ed;
}
```

`space-style` blocks load after SilverBullet's own stylesheets, so a rule with the same selector wins. The dark rule is more specific than `html`, so a variable SilverBullet redefines for dark mode needs a dark value from you too; otherwise dark mode keeps SilverBullet's. Several blocks load by `/* priority: N */` (a comment at the top of a block), highest first, so a block with a lower priority loads later and wins ties.

Switch the theme for a screenshot with `lua`: `js.window.document.documentElement.setAttribute("data-theme", "dark")`, then set it back to `"light"`.

# Inspecting an element
Run with `lua` on the page that shows the element; change the selector:

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

Add other properties (`cs.color`, `cs.backgroundColor`, `cs.lineHeight`) as needed. `document.elementFromPoint(x, y)` finds what sits at a spot in a screenshot.

# Editor specifics
* **Space editor lines with padding.** The editor works out which line a click hits from line heights, and margins are not part of a line's height, so vertical margin on a heading (`.sb-line-h1` to `.sb-line-h6`) or any `.cm-line` sends clicks below it to the wrong line, more so further down the page. `padding-top` and `padding-bottom` give the same look and keep clicks exact.
* **Links carry negative side margins.** `.sb-wiki-link` (and `a.wiki-link` in rendered Markdown) has `padding: 0 5px; margin: 0 -5px` to widen its background without moving text. A link styled as a tile or button needs its own `margin`, set with a selector at least as specific.
* **Code blocks set the monospace font.** `.sb-line-fenced-code`, `.sb-line-code`, `.sb-frontmatter` and `.sb-code` use `--editor-monospace-font`, and a widget rendered from a fenced code block sits inside such a line and inherits it. Give the widget's own root class a `font-family` (`var(--editor-font)` for the body text font).
* **List items contain an invisible character.** Each list item has a `span.sb-word-joiner` holding U+2060. A font without that glyph draws a box: keep a fallback in every font stack (`"Lato", system-ui, sans-serif`), or set `.sb-word-joiner { font-family: system-ui; }`.
* **Fonts can also come from configuration.** The `Fonts` setting picks the interface and editor fonts without CSS; a `space-style` that sets a font variable wins over it.
