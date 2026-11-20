---
description: "The icon names you can use for pages, tags, buttons, commands and views."
tags: glossary
---
Everywhere SilverBullet takes an icon, it takes the name of a [Lucide](https://lucide.dev/icons) icon: `house`, `book`, `calendar`, `square-check-big`. There are around 2,100 of them. Browse them at [lucide.dev/icons](https://lucide.dev/icons), or search them in SilverBullet’s icon picker, which also matches related words when online (searching `home` finds `house`); offline it matches names only.

The same names work in every place that has an icon:

* [[Reference/Theming/Page Decorations|Page decorations]]: `pageDecoration.icon` in a page’s frontmatter
* [[API/tag|Tags]]: a tag’s `icon`, which is also the default icon of every page with the tag
* [[^Library/Std/APIs/Action Button|Action buttons]] and the [[^Library/Std/APIs/Markup Bar|markup bar]]
* [[API/command|Commands]] (shown in the command palette) and [[API/slashCommand|slash commands]]
* [[API/widget|Views]]: row, action, segment and chip icons
* [[API/icon]], to render an icon as SVG in your own widgets

An unknown name shows a question-mark icon and logs a warning in the console.

# Picking an icon
* `Page: Set Icon` opens the icon picker and stores the result as the current page’s `pageDecoration.icon`. Pick **No icon** to remove it.
* In [[Workbench/Data]], the icon button on a tag’s schema opens the same picker.
* Typing `icon:` in frontmatter, including under `pageDecoration:`, completes icon names with a preview.
* From [[Reference/Space Lua]], `editor.pickIcon { title = "…" }` shows the picker and returns the name, `""` for no icon, or `nil` when cancelled.

# Renamed and removed icons
SilverBullet used [Feather](https://feathericons.com) icons before. Lucide started as a fork of Feather, so most Feather names still work as they are. A few changes:

* The `feather:` prefix (`feather:lock`) still works for now, but just use `lock`.
* The `md-*` editor icons still work for now, with a warning, and map to these Lucide icons:

| Old name | Lucide name |
|---|---|
| `md-format-bold` | `letter-b` (also `bold`) |
| `md-format-italic` | `italic` |
| `md-format-strikethrough` | `strikethrough` |
| `md-format-quote` | `quote` |
| `md-format-size` | `letter-h` (also `heading`) |
| `md-format-list-bulleted` | `list` |
| `md-format-list-numbered` | `list-ordered` |
| `md-format-indent-increase` | `list-indent-increase` |
| `md-format-indent-decrease` | `list-indent-decrease` |
| `md-checklist` | `list-checks` |
| `md-code` | `code` |
| `md-link` | `link` |
| `md-image` | `image` |
| `md-home` | `house` |
| `md-horizontal-rule` | `minus` |
| `md-file-upload` | `upload` |
| `md-terminal` | `square-terminal` |
| `md-outline-library-books` | `library-big` |
| `md-unfold-less` | `chevrons-down-up` |
| `md-unfold-more` | `chevrons-up-down` |

* Feather’s `tool` is now `wrench`.
* Brand icons (`github`, `gitlab`, `twitter`, `slack`, `figma`, `youtube`, …) are gone: Lucide doesn’t include them.
* Inline `<svg>` markup is no longer accepted as an icon. Pick a Lucide icon instead.
