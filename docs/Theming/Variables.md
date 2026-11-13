---
description: "Every theme variable, with its light and dark values."
tags: customization
references:
- client/styles/theme.scss
- client/styles/_dark_palette.scss
- client/styles/theme_docs.test.ts
---
These are the CSS variables a theme sets. They come in two levels:

* **Base variables** are the palette: page and text colors, the accent, link colors, tones, the code palette, the page width and the fonts. Setting a handful of them gives a complete theme.
* **Specific variables** color one part of the interface, such as the top bar, pickers or hashtags. Their defaults derive from base variables, so you only set one when the derived color isn’t what you want.

Set them in a plain `html { … }` rule. [[Theming/Creating a Theme]] shows how, and explains why a base variable set on another element doesn’t re-derive the specific ones.

How to read the lists:

* **Light** is the built-in default, which [[^Library/Std/Themes/SilverBullet Light]] uses.
* **Dark** is the built-in dark palette, which [[^Library/Std/Themes/SilverBullet Dark]] uses and every dark theme starts from. When it’s empty, the light definition applies, computed from the dark base colors.
* **Since** is the first release in which you could set the variable, or `edge` for the [edge builds](https://github.com/silverbulletmd/silverbullet/releases/tag/edge). Variables marked **experimental** may change or go away, usually because the feature they belong to is experimental. All others are stable.
* The font variables belong to [[Fonts]]: a theme suggests fonts in its frontmatter instead of setting them.

## Surfaces and text
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Surfaces and text"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Accent
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Accent"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Links and meta
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Links and meta"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Marks
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Marks"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Tones
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Tones"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Code palette
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Code palette"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Layout
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Layout"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Fonts
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Fonts"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

# Specific variables
## Shared surfaces
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Shared surfaces"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Top bar
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Top bar"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Panels
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Panels"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Modals and pickers
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Modals and pickers"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Notifications and alerts
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Notifications and alerts"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Buttons and fields
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Buttons and fields"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Editor text
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Editor text"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Editor panels and completion
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Editor panels and completion"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Headings, lists and tasks
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Headings, lists and tasks"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Editor links and tags
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Editor links and tags"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Markup and frontmatter
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Markup and frontmatter"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Blocks
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Blocks"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}

## Admonitions
${query[[
  from v = index.objects("theme-variable")
  where v.group == "Admonitions"
  select template.new[==[* `${name}`: ${description}${light and (" Light `" .. light .. "`" .. (dark and (", dark `" .. dark .. "`") or "") .. ".") or ""} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](v)
]]}
