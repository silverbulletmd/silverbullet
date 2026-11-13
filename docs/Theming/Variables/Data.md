---
description: "The theme variable objects that Theming/Variables lists."
references:
- client/styles/theme_docs.test.ts
- client/styles/theme.scss
- client/styles/_dark_palette.scss
---
The `#theme-variable` objects that [[Theming/Variables]] lists, one block per group. You can query them yourself with `index.objects("theme-variable")`. Each has:

* `name`: the variable, such as `--root-color`.
* `group`: the part of the interface it belongs to, such as `Top bar`.
* `level`: `base` for the palette a theme starts from, `specific` for everything that derives from it.
* `light`: its value in SilverBullet Light, the built-in default.
* `dark`: its value in SilverBullet Dark, the built-in dark palette, when that differs.
* `derivesFrom`: the variables its default is computed from.
* `since`: the first release in which you could set it, or `edge`.
* `stability`: `stable`, `experimental` or `deprecated`.
* `description`: what it colors.

# Data
```#theme-variable
name: "--root-background-color"
group: Surfaces and text
level: base
light: "#fcfcfd"
dark: "#15171e"
since: "0.3.6"
stability: stable
description: "The page background. Most surfaces (top bar, panels, buttons, modals) mix it with another base color."
---
name: "--root-color"
group: Surfaces and text
level: base
light: "#1f2330"
dark: "#e3e5ec"
since: "0.3.6"
stability: stable
description: "Body text color."
---
name: "--subtle-color"
group: Surfaces and text
level: base
light: "#6e7485"
dark: "#8c92a3"
since: "0.3.6"
stability: stable
description: "Secondary text: hints, descriptions, counts, inactive controls."
---
name: "--subtle-background-color"
group: Surfaces and text
level: base
light: "rgba(31, 35, 48, 0.05)"
dark: "rgba(227, 229, 236, 0.06)"
since: "0.3.6"
stability: stable
description: "A faint tint for code, quotes and hover states. Usually semi-transparent."
---
name: "--ui-surface-border-color"
group: Surfaces and text
level: base
light: "#e4e6ee"
dark: "#2a2e3a"
since: "2.9.0"
stability: stable
description: "Borders of panels, modals, buttons and rows."
```


```#theme-variable
name: "--ui-accent-color"
group: Accent
level: base
light: "#0059b8"
dark: "#5b7cf0"
since: "0.3.6"
stability: stable
description: "The accent: primary buttons, focus rings, the selected option, progress."
---
name: "--ui-accent-contrast-color"
group: Accent
level: base
light: "#fff"
dark: "#ffffff"
since: "0.7.7"
stability: stable
description: "Text on an accent fill, such as a primary button's label."
---
name: "--ui-accent-strong-color"
group: Accent
level: base
light: "color-mix(in srgb, var(--ui-accent-color), black 20%)"
dark: "color-mix(in srgb, var(--ui-accent-color), black 40%)"
derivesFrom:
- "--ui-accent-color"
since: "edge"
stability: stable
description: "A darker accent fill that carries light text, for a theme that fills hashtag pills or the selected completion with the accent, as Classic does. With a very light accent, set it yourself."
---
name: "--ui-accent-strong-contrast-color"
group: Accent
level: base
light: "color-mix(in srgb, var(--ui-accent-color) 8%, white)"
derivesFrom:
- "--ui-accent-color"
since: "edge"
stability: stable
description: "Text on `--ui-accent-strong-color`. Assumes the strong fill comes out dark; a theme with a very light accent sets both."
```


```#theme-variable
name: "--link-color"
group: Links and meta
level: base
light: "var(--ui-accent-text-color)"
derivesFrom:
- "--ui-accent-text-color"
since: "0.3.6"
stability: stable
description: "Links and wiki links to existing pages."
---
name: "--link-missing-color"
group: Links and meta
level: base
light: "#c2410c"
dark: "#f59e5b"
since: "0.3.6"
stability: stable
description: "Wiki links to pages that don't exist yet."
---
name: "--link-invalid-color"
group: Links and meta
level: base
light: "#bb08e7"
dark: "#d444f8"
since: "2.0.0-rc1"
stability: stable
description: "Invalid and ambiguous wiki links."
---
name: "--meta-color"
group: Links and meta
level: base
light: "#a6abba"
dark: "#5a6072"
since: "0.3.6"
stability: stable
description: "Markup the editor shows while you edit, such as `**` and `#`."
---
name: "--meta-subtle-color"
group: Links and meta
level: base
light: "#b9bdc9"
dark: "#525868"
since: "0.3.6"
stability: stable
description: "Quieter markup: list bullets, link URLs, heading marks, code comments."
```


```#theme-variable
name: "--highlight-color"
group: Marks
level: base
light: "color-mix(in srgb, #f5c518 32%, transparent)"
since: "0.0.22"
stability: stable
description: "The `==highlight==` background. Frontmatter takes a faint tint of it."
```


```#theme-variable
name: "--tone-success"
group: Tones
level: base
light: "#1f7a43"
dark: "#6cc487"
since: "edge"
stability: stable
description: "Text and marks for success. Use it in your own styles too."
---
name: "--tone-success-soft"
group: Tones
level: base
light: "#e2f2e7"
dark: "#1c3424"
since: "edge"
stability: stable
description: "Background that goes with `--tone-success`."
---
name: "--tone-warning"
group: Tones
level: base
light: "#94570a"
dark: "#e7b05a"
since: "edge"
stability: stable
description: "Text and marks for warning. Use it in your own styles too."
---
name: "--tone-warning-soft"
group: Tones
level: base
light: "#fbeed8"
dark: "#3a2c14"
since: "edge"
stability: stable
description: "Background that goes with `--tone-warning`."
---
name: "--tone-danger"
group: Tones
level: base
light: "#b4232f"
dark: "#f08a8a"
since: "edge"
stability: stable
description: "Text and marks for danger and errors. Use it in your own styles too."
---
name: "--tone-danger-soft"
group: Tones
level: base
light: "#fbe2e4"
dark: "#3d2023"
since: "edge"
stability: stable
description: "Background that goes with `--tone-danger`."
---
name: "--tone-info"
group: Tones
level: base
light: "#1d5fa8"
dark: "#8fc4ef"
since: "edge"
stability: stable
description: "Text and marks for information. Use it in your own styles too."
---
name: "--tone-info-soft"
group: Tones
level: base
light: "#e1ecf8"
dark: "#192c40"
since: "edge"
stability: stable
description: "Background that goes with `--tone-info`."
---
name: "--tone-neutral"
group: Tones
level: base
light: "color-mix(in srgb, var(--subtle-color), var(--root-color) 25%)"
derivesFrom:
- "--subtle-color"
- "--root-color"
since: "edge"
stability: stable
description: "Text and marks for neutral badges. Use it in your own styles too."
---
name: "--tone-neutral-soft"
group: Tones
level: base
light: "color-mix(in srgb, var(--root-background-color), var(--ui-surface-border-color) 50%)"
derivesFrom:
- "--root-background-color"
- "--ui-surface-border-color"
since: "edge"
stability: stable
description: "Background that goes with `--tone-neutral`."
---
name: "--tone-accent"
group: Tones
level: base
light: "var(--ui-accent-color)"
derivesFrom:
- "--ui-accent-color"
since: "edge"
stability: stable
description: "Text and marks for accent. Use it in your own styles too."
---
name: "--tone-accent-soft"
group: Tones
level: base
light: "color-mix(in srgb, var(--ui-accent-color) 14%, transparent)"
dark: "color-mix(in srgb, var(--ui-accent-color) 22%, transparent)"
derivesFrom:
- "--ui-accent-color"
since: "edge"
stability: stable
description: "Background that goes with `--tone-accent`."
```


```#theme-variable
name: "--editor-code-color"
group: Code palette
level: base
light: "#7c828e"
since: "0.7.0"
stability: stable
description: "Text in code blocks."
---
name: "--editor-code-variable-color"
group: Code palette
level: base
light: "#024866"
dark: "#41a3ce"
since: "0.3.6"
stability: stable
description: "Variable names in highlighted code."
---
name: "--editor-code-typename-color"
group: Code palette
level: base
light: "#038138"
since: "0.3.6"
stability: stable
description: "Type names in highlighted code."
---
name: "--editor-code-string-color"
group: Code palette
level: base
light: "#540293"
dark: "#986db9"
since: "0.3.6"
stability: stable
description: "Strings in highlighted code, and string values in the Workbench."
---
name: "--editor-code-number-color"
group: Code palette
level: base
light: "#01833c"
dark: "#986db9"
since: "0.3.6"
stability: stable
description: "Numbers in highlighted code, and numbers in the Workbench."
---
name: "--editor-code-operator-color"
group: Code palette
level: base
light: "#808080"
since: "0.7.0"
stability: stable
description: "Operators in highlighted code."
---
name: "--editor-code-atom-color"
group: Code palette
level: base
light: "#5a0000"
dark: "#d6222e"
since: "0.3.6"
stability: stable
description: "Atoms (keywords like `true`) in highlighted code, and inline attribute names."
---
name: "--editor-code-comment-color"
group: Code palette
level: base
light: "color-mix(in srgb, var(--subtle-color), var(--meta-color))"
derivesFrom:
- "--subtle-color"
- "--meta-color"
since: "0.3.6"
stability: stable
description: "Comments in highlighted code."
```


```#theme-variable
name: "--editor-width"
group: Layout
level: base
light: "800px"
since: "0.2.12"
stability: stable
description: "Maximum width of the page text."
```


```#theme-variable
name: "--ui-font"
group: Fonts
level: base
light: "Inter, system-ui, sans-serif"
since: "0.0.22"
stability: stable
description: "Interface font: always Lora, see [[Fonts]]."
---
name: "--editor-font"
group: Fonts
level: base
light: "\"iA-Mono\", \"Menlo\""
since: "0.0.22"
stability: stable
description: "Page text font. Set by [[Fonts]]."
---
name: "--editor-monospace-font"
group: Fonts
level: base
light: "\"iA-Mono\", \"Menlo\", monospace"
since: "2.8.0"
stability: stable
description: "Font for code, frontmatter, tables being edited and `${...}`. Set by [[Fonts]]."
---
name: "--editor-font-size"
group: Fonts
level: base
light: "18px"
since: "edge"
stability: stable
description: "Page text size. Set by [[Fonts]]."
---
name: "--editor-font-x-height"
group: Fonts
level: base
light: "none"
since: "edge"
stability: experimental
description: "The editor font's x-height as a fraction of its size, which code in the editor is scaled to match (`font-size-adjust`). Measured by [[Fonts]]; `none` turns the scaling off."
---
name: "--editor-column-width"
group: Fonts
level: base
light: "1ch"
since: "edge"
stability: stable
description: "One step of list, quote and comment indentation in the editor. `1ch` is the width of a `0` in the editor font; a proportional font may want it wider. See [[Fonts#Indent width]]."
```


```#theme-variable
name: "--ui-accent-text-color"
group: Shared surfaces
level: specific
light: "color-mix(in oklab, var(--ui-accent-color), var(--root-color) 15%)"
dark: "color-mix(in oklab, var(--ui-accent-color), var(--root-color) 35%)"
derivesFrom:
- "--ui-accent-color"
- "--root-color"
since: "0.7.7"
stability: stable
description: "Accent-colored text and outlines, such as links in the Workbench."
---
name: "--ui-accent-muted-color"
group: Shared surfaces
level: specific
light: "oklch(from var(--ui-accent-color) l calc(c * 0.25) h)"
derivesFrom:
- "--ui-accent-color"
since: "edge"
stability: experimental
description: "The accent's hue at a quarter of its strength. The accent itself marks what you act on (links, the caret, selection, checkboxes, buttons); this muted version tints everything else (washes, bullets, quote bars), so a bright accent doesn't turn the whole page that color."
---
name: "--ui-accent-muted-soft-color"
group: Shared surfaces
level: specific
light: "color-mix(in srgb, var(--ui-accent-muted-color) 14%, transparent)"
dark: "color-mix(in srgb, var(--ui-accent-muted-color) 22%, transparent)"
derivesFrom:
- "--ui-accent-muted-color"
since: "edge"
stability: experimental
description: "A translucent muted accent for pills and hairlines: hashtags, attributes, card and table header borders."
---
name: "--ui-label-color"
group: Shared surfaces
level: specific
light: "color-mix(in oklab, var(--root-color), var(--subtle-color) 25%)"
derivesFrom:
- "--root-color"
- "--subtle-color"
since: "edge"
stability: experimental
description: "Labels: table headers, card titles, frontmatter keys, hashtags and picker titles. Ink rather than accent."
---
name: "--ui-accent-surface-color"
group: Shared surfaces
level: specific
light: "color-mix(in srgb, var(--ui-accent-muted-color) 6%, var(--root-background-color))"
derivesFrom:
- "--ui-accent-muted-color"
- "--root-background-color"
since: "edge"
stability: experimental
description: "A faint wash of the accent behind cards, frontmatter, code blocks and panels."
---
name: "--ui-surface-background-color"
group: Shared surfaces
level: specific
light: "var(--root-background-color)"
derivesFrom:
- "--root-background-color"
since: "2.9.0"
stability: stable
description: "Background of the Workbench, standalone pages and revision previews."
---
name: "--ui-surface-color"
group: Shared surfaces
level: specific
light: "var(--root-color)"
derivesFrom:
- "--root-color"
since: "2.9.0"
stability: stable
description: "Text on those surfaces."
---
name: "--ui-surface-subtle-color"
group: Shared surfaces
level: specific
light: "var(--subtle-color)"
derivesFrom:
- "--subtle-color"
since: "2.9.0"
stability: stable
description: "Secondary text on those surfaces."
---
name: "--ui-surface-section-background-color"
group: Shared surfaces
level: specific
light: "var(--subtle-background-color)"
derivesFrom:
- "--subtle-background-color"
since: "2.9.0"
stability: stable
description: "Cards and sections in the Workbench and the dashboard."
---
name: "--ui-surface-hover-background-color"
group: Shared surfaces
level: specific
light: "var(--subtle-background-color)"
derivesFrom:
- "--subtle-background-color"
since: "2.9.0"
stability: stable
description: "Hovered rows and buttons in lists."
---
name: "--ui-radius-sm"
group: Shared surfaces
level: specific
light: "6px"
since: edge
stability: stable
description: "Corner radius of small parts: menu items and completion rows."
---
name: "--ui-radius-md"
group: Shared surfaces
level: specific
light: "8px"
since: edge
stability: stable
description: "Corner radius of controls: buttons, fields, picker and sidebar rows."
---
name: "--ui-radius-lg"
group: Shared surfaces
level: specific
light: "10px"
since: edge
stability: stable
description: "Corner radius of popovers and blocks: menus, notifications, completion, code blocks, callouts and widgets."
---
name: "--ui-radius-xl"
group: Shared surfaces
level: specific
light: "12px"
since: edge
stability: stable
description: "Corner radius of cards and dialogs: tables, page widgets, the frontmatter form and prompts."
---
name: "--ui-radius-pill"
group: Shared surfaces
level: specific
light: "99px"
since: edge
stability: stable
description: "Corner radius of pills: badges, chips, attributes and segmented controls."
---
name: "--ui-shadow-card"
group: Shared surfaces
level: specific
light: "0 1px 2px color-mix(in srgb, var(--root-color) 6%, transparent), 0 8px 24px -12px color-mix(in srgb, var(--ui-accent-muted-color) 30%, transparent)"
derivesFrom:
- "--root-color"
- "--ui-accent-muted-color"
since: edge
stability: stable
description: "Shadow of a card lifted off the page: tables, notifications, input menus and footnote previews."
---
name: "--ui-shadow-popover"
group: Shared surfaces
level: specific
light: "0 12px 32px -8px var(--modal-shadow-color)"
derivesFrom:
- "--modal-shadow-color"
since: edge
stability: stable
description: "Shadow of popovers: completion and row menus."
---
name: "--ui-focus-ring"
group: Shared surfaces
level: specific
light: "3px solid var(--tone-accent-soft)"
derivesFrom:
- "--tone-accent-soft"
since: edge
stability: stable
description: "The `outline` of a control with keyboard focus."
---
name: "--ui-font-size-sm"
group: Shared surfaces
level: specific
light: "13.5px"
since: edge
stability: stable
description: "Interface text in controls: buttons, input menus and notifications."
```


```#theme-variable
name: "--top-color"
group: Top bar
level: specific
light: "var(--root-color)"
derivesFrom:
- "--root-color"
since: "0.3.6"
stability: stable
description: "Top bar text."
---
name: "--top-background-color"
group: Top bar
level: specific
light: "var(--root-background-color)"
derivesFrom:
- "--root-background-color"
since: "0.3.6"
stability: stable
description: "Top bar background. Mobile browsers and the Desktop title bar take their color from it."
---
name: "--top-border-color"
group: Top bar
level: specific
light: "transparent"
since: "0.3.6"
stability: stable
description: "Line under the top bar and the mobile keyboard bar."
---
name: "--top-sync-error-color"
group: Top bar
level: specific
light: "var(--top-color)"
derivesFrom:
- "--top-color"
since: "0.3.6"
stability: stable
description: "Top bar text while sync fails."
---
name: "--top-sync-error-background-color"
group: Top bar
level: specific
light: "var(--tone-warning-soft)"
derivesFrom:
- "--tone-warning-soft"
since: "0.3.6"
stability: stable
description: "Top bar background while sync fails."
---
name: "--top-saved-color"
group: Top bar
level: specific
light: "var(--root-color)"
derivesFrom:
- "--root-color"
since: "0.3.6"
stability: stable
description: "Page name once the page is saved."
---
name: "--top-unsaved-color"
group: Top bar
level: specific
light: "color-mix(in srgb, var(--root-color), var(--subtle-color) 70%)"
derivesFrom:
- "--root-color"
- "--subtle-color"
since: "0.3.6"
stability: stable
description: "Page name while changes are unsaved."
---
name: "--top-loading-color"
group: Top bar
level: specific
light: "var(--subtle-color)"
derivesFrom:
- "--subtle-color"
since: "0.3.6"
stability: stable
description: "Page name while the page loads, and loading widgets."
---
name: "--top-page-folder-color"
group: Top bar
level: specific
light: "var(--subtle-color)"
derivesFrom:
- "--subtle-color"
since: "edge"
stability: experimental
description: "The folder part of the page name in the top bar, such as `Projects/` in `Projects/Phoenix`. Set it to `currentColor` to follow the page name's color."
---
name: "--top-page-folder-font-weight"
group: Top bar
level: specific
light: "500"
since: "edge"
stability: experimental
description: "Font weight of the folder part of the page name in the top bar."
---
name: "--progress-background-color"
group: Top bar
level: specific
light: "var(--ui-surface-border-color)"
derivesFrom:
- "--ui-surface-border-color"
since: "2.0.0-pre1"
stability: stable
description: "Track of the sync and index progress circle."
---
name: "--progress-sync-color"
group: Top bar
level: specific
light: "var(--root-color)"
derivesFrom:
- "--root-color"
since: "2.0.0-pre1"
stability: stable
description: "Fill of the progress circle while syncing."
---
name: "--progress-index-color"
group: Top bar
level: specific
light: "var(--ui-accent-color)"
derivesFrom:
- "--ui-accent-color"
since: "2.0.0-pre1"
stability: stable
description: "Fill of the progress circle while indexing."
---
name: "--action-button-background-color"
group: Top bar
level: specific
light: "transparent"
since: "0.3.6"
stability: stable
description: "Background of the top bar action buttons."
---
name: "--action-button-color"
group: Top bar
level: specific
light: "color-mix(in srgb, var(--root-color), var(--subtle-color) 35%)"
dark: "color-mix(in srgb, var(--root-color), var(--subtle-color) 60%)"
derivesFrom:
- "--root-color"
- "--subtle-color"
since: "0.3.6"
stability: stable
description: "Top bar action icons."
---
name: "--action-button-hover-color"
group: Top bar
level: specific
light: "var(--ui-accent-text-color)"
derivesFrom:
- "--ui-accent-text-color"
since: "0.3.6"
stability: stable
description: "Top bar action icons on hover."
```


```#theme-variable
name: "--panel-background-color"
group: Panels
level: specific
light: "var(--ui-accent-surface-color)"
derivesFrom:
- "--ui-accent-surface-color"
since: "0.3.6"
stability: stable
description: "Side panels, and dark modals."
---
name: "--panel-border-color"
group: Panels
level: specific
light: "var(--ui-surface-border-color)"
derivesFrom:
- "--ui-surface-border-color"
since: "0.3.6"
stability: stable
description: "Border between a side panel and the editor."
---
name: "--bhs-background-color"
group: Panels
level: specific
light: "var(--root-background-color)"
derivesFrom:
- "--root-background-color"
since: "0.3.6"
stability: stable
description: "Bottom panel background."
---
name: "--bhs-border-color"
group: Panels
level: specific
light: "color-mix(in srgb, var(--root-background-color), var(--subtle-color) 41%)"
derivesFrom:
- "--root-background-color"
- "--subtle-color"
since: "0.3.6"
stability: stable
description: "Line above the bottom panel."
```


```#theme-variable
name: "--modal-color"
group: Modals and pickers
level: specific
light: "var(--root-color)"
derivesFrom:
- "--root-color"
since: "0.3.6"
stability: stable
description: "Text in pickers, prompts, the command palette and autocomplete."
---
name: "--modal-background-color"
group: Modals and pickers
level: specific
light: "var(--root-background-color)"
dark: "var(--panel-background-color)"
derivesFrom:
- "--root-background-color"
since: "0.3.6"
stability: stable
description: "Background of those boxes."
---
name: "--modal-border-color"
group: Modals and pickers
level: specific
light: "var(--ui-surface-border-color)"
derivesFrom:
- "--ui-surface-border-color"
since: "0.3.6"
stability: stable
description: "Their border."
---
name: "--modal-backdrop-color"
group: Modals and pickers
level: specific
light: "rgba(20, 22, 40, 0.18)"
dark: "rgba(0, 0, 0, 0.5)"
since: "2.9.0"
stability: stable
description: "Backdrop behind a modal. Transparent by default; set it to dim the page."
---
name: "--modal-shadow-color"
group: Modals and pickers
level: specific
light: "rgba(20, 22, 40, 0.2)"
dark: "rgba(0, 0, 0, 0.55)"
since: "edge"
stability: experimental
description: "Shadow under a modal."
---
name: "--modal-header-label-color"
group: Modals and pickers
level: specific
light: "var(--ui-label-color)"
derivesFrom:
- "--ui-label-color"
since: "0.3.6"
stability: stable
description: "A picker's title."
---
name: "--modal-help-background-color"
group: Modals and pickers
level: specific
light: "transparent"
since: "0.3.6"
stability: stable
description: "Background of a picker's help line."
---
name: "--modal-help-color"
group: Modals and pickers
level: specific
light: "var(--subtle-color)"
derivesFrom:
- "--subtle-color"
since: "0.3.6"
stability: stable
description: "Text of a picker's help line."
---
name: "--modal-selected-option-background-color"
group: Modals and pickers
level: specific
light: "var(--tone-accent-soft)"
derivesFrom:
- "--tone-accent-soft"
since: "0.3.6"
stability: stable
description: "The selected option."
---
name: "--modal-selected-option-color"
group: Modals and pickers
level: specific
light: "var(--ui-accent-text-color)"
derivesFrom:
- "--ui-accent-text-color"
since: "0.3.6"
stability: stable
description: "Text of the selected option."
---
name: "--modal-hint-background-color"
group: Modals and pickers
level: specific
light: "var(--tone-accent-soft)"
derivesFrom:
- "--tone-accent-soft"
since: "0.3.6"
stability: stable
description: "Hint chips next to options, such as Create and key shortcuts."
---
name: "--modal-hint-color"
group: Modals and pickers
level: specific
light: "var(--ui-accent-text-color)"
derivesFrom:
- "--ui-accent-text-color"
since: "0.3.6"
stability: stable
description: "Text in hint chips."
---
name: "--modal-description-color"
group: Modals and pickers
level: specific
light: "var(--subtle-color)"
derivesFrom:
- "--subtle-color"
since: "0.5.9"
stability: stable
description: "An option's description."
---
name: "--modal-selected-option-description-color"
group: Modals and pickers
level: specific
light: "var(--ui-accent-text-color)"
derivesFrom:
- "--ui-accent-text-color"
since: "2.0.0-rc1"
stability: stable
description: "The selected option's description."
```


```#theme-variable
name: "--notifications-border-color"
group: Notifications and alerts
level: specific
light: "var(--ui-surface-border-color)"
derivesFrom:
- "--ui-surface-border-color"
since: "0.3.6"
stability: stable
description: "Border of notifications."
---
name: "--notification-info-background-color"
group: Notifications and alerts
level: specific
light: "var(--modal-background-color)"
derivesFrom:
- "--modal-background-color"
since: "0.3.6"
stability: stable
description: "Information notifications."
---
name: "--notification-error-background-color"
group: Notifications and alerts
level: specific
light: "var(--modal-background-color)"
derivesFrom:
- "--modal-background-color"
since: "0.3.6"
stability: stable
description: "Error notifications."
---
name: "--notification-warning-background-color"
group: Notifications and alerts
level: specific
light: "var(--modal-background-color)"
derivesFrom:
- "--modal-background-color"
since: "2.6.0"
stability: stable
description: "Warning notifications."
---
name: "--alert-error-color"
group: Notifications and alerts
level: specific
light: "var(--tone-danger)"
derivesFrom:
- "--tone-danger"
since: "2.9.0"
stability: stable
description: "Error messages and alerts."
---
name: "--alert-error-background-color"
group: Notifications and alerts
level: specific
light: "var(--tone-danger-soft)"
derivesFrom:
- "--tone-danger-soft"
since: "2.9.0"
stability: stable
description: "Background of error alerts."
---
name: "--alert-error-border-color"
group: Notifications and alerts
level: specific
light: "color-mix(in srgb, var(--tone-danger) 20%, var(--tone-danger-soft))"
derivesFrom:
- "--tone-danger"
- "--tone-danger-soft"
since: "2.9.0"
stability: stable
description: "Border of error alerts."
---
name: "--alert-warning-color"
group: Notifications and alerts
level: specific
light: "var(--tone-warning)"
derivesFrom:
- "--tone-warning"
since: "2.9.0"
stability: stable
description: "Warnings."
---
name: "--alert-warning-background-color"
group: Notifications and alerts
level: specific
light: "var(--tone-warning-soft)"
derivesFrom:
- "--tone-warning-soft"
since: "2.9.0"
stability: stable
description: "Background of warning alerts and conflict widgets."
---
name: "--alert-warning-border-color"
group: Notifications and alerts
level: specific
light: "color-mix(in srgb, var(--tone-warning) 20%, var(--tone-warning-soft))"
derivesFrom:
- "--tone-warning"
- "--tone-warning-soft"
since: "2.9.0"
stability: stable
description: "Border of warning alerts and conflict widgets."
---
name: "--alert-info-color"
group: Notifications and alerts
level: specific
light: "var(--tone-info)"
derivesFrom:
- "--tone-info"
since: "2.9.0"
stability: stable
description: "Information alerts."
---
name: "--alert-info-background-color"
group: Notifications and alerts
level: specific
light: "var(--tone-info-soft)"
derivesFrom:
- "--tone-info-soft"
since: "2.9.0"
stability: stable
description: "Background of information alerts."
---
name: "--alert-info-border-color"
group: Notifications and alerts
level: specific
light: "color-mix(in srgb, var(--tone-info) 20%, var(--tone-info-soft))"
derivesFrom:
- "--tone-info"
- "--tone-info-soft"
since: "2.9.0"
stability: stable
description: "Border of information alerts."
---
name: "--danger-color"
group: Notifications and alerts
level: specific
light: "var(--tone-danger)"
derivesFrom:
- "--tone-danger"
since: "2.9.0"
stability: stable
description: "Destructive actions and error text."
---
name: "--danger-contrast-color"
group: Notifications and alerts
level: specific
light: "var(--root-background-color)"
derivesFrom:
- "--root-background-color"
since: "2.9.0"
stability: stable
description: "Text on a danger button."
---
name: "--success-color"
group: Notifications and alerts
level: specific
light: "var(--tone-success)"
derivesFrom:
- "--tone-success"
since: "2.9.0"
stability: stable
description: "Success marks and status dots."
---
name: "--badge-background-color"
group: Notifications and alerts
level: specific
light: "var(--tone-neutral-soft)"
derivesFrom:
- "--tone-neutral-soft"
since: "2.9.0"
stability: stable
description: "Badges and chips, such as counts."
---
name: "--badge-color"
group: Notifications and alerts
level: specific
light: "var(--tone-neutral)"
derivesFrom:
- "--tone-neutral"
since: "2.9.0"
stability: stable
description: "Text in badges."
```


```#theme-variable
name: "--button-background-color"
group: Buttons and fields
level: specific
light: "color-mix(in srgb, var(--root-background-color), var(--ui-surface-border-color) 23%)"
dark: "color-mix(in srgb, var(--root-background-color), var(--ui-surface-border-color) 45%)"
derivesFrom:
- "--root-background-color"
- "--ui-surface-border-color"
since: "0.7.7"
stability: stable
description: "Buttons."
---
name: "--button-hover-background-color"
group: Buttons and fields
level: specific
light: "color-mix(in srgb, var(--root-background-color), var(--ui-surface-border-color) 43.5%)"
dark: "color-mix(in srgb, var(--root-background-color), var(--ui-surface-border-color) 70%)"
derivesFrom:
- "--root-background-color"
- "--ui-surface-border-color"
since: "0.7.7"
stability: stable
description: "Buttons on hover."
---
name: "--button-color"
group: Buttons and fields
level: specific
light: "var(--root-color)"
derivesFrom:
- "--root-color"
since: "0.7.7"
stability: stable
description: "Button text."
---
name: "--button-border-color"
group: Buttons and fields
level: specific
light: "var(--ui-surface-border-color)"
derivesFrom:
- "--ui-surface-border-color"
since: "0.7.7"
stability: stable
description: "Button and drop-down border."
---
name: "--primary-button-color"
group: Buttons and fields
level: specific
light: "var(--ui-accent-contrast-color)"
derivesFrom:
- "--ui-accent-contrast-color"
since: "0.7.7"
stability: stable
description: "Primary button text."
---
name: "--primary-button-background-color"
group: Buttons and fields
level: specific
light: "var(--ui-accent-color)"
derivesFrom:
- "--ui-accent-color"
since: "0.7.7"
stability: stable
description: "Primary buttons."
---
name: "--primary-button-hover-background-color"
group: Buttons and fields
level: specific
light: "color-mix(in srgb, var(--primary-button-background-color), black 18%)"
derivesFrom:
- "--primary-button-background-color"
since: "0.7.7"
stability: stable
description: "Primary buttons on hover."
---
name: "--primary-button-border-color"
group: Buttons and fields
level: specific
light: "transparent"
since: "0.7.7"
stability: stable
description: "Primary button border."
---
name: "--text-field-background-color"
group: Buttons and fields
level: specific
light: "var(--button-background-color)"
derivesFrom:
- "--button-background-color"
since: "0.7.7"
stability: stable
description: "Text fields and drop-downs."
---
name: "--text-field-focus-color"
group: Buttons and fields
level: specific
light: "color-mix(in srgb, var(--ui-accent-color) 45%, var(--ui-surface-border-color))"
derivesFrom:
- "--ui-accent-color"
- "--ui-surface-border-color"
since: "2.11.0"
stability: stable
description: "Border of a focused text field."
```


```#theme-variable
name: "--editor-text-color"
group: Editor text
level: specific
light: "var(--root-color)"
derivesFrom:
- "--root-color"
since: "2.0.0-rc1"
stability: stable
description: "Page text in the editor."
---
name: "--editor-error-color"
group: Editor text
level: specific
light: "var(--danger-color)"
derivesFrom:
- "--danger-color"
since: "2.6.0"
stability: stable
description: "Errors in the page, such as unresolved footnotes."
---
name: "--editor-accent-muted"
group: Editor text
level: specific
light: "color-mix(in srgb, var(--meta-subtle-color) 60%, transparent)"
derivesFrom:
- "--meta-subtle-color"
since: "2.8.0"
stability: stable
description: "Muted marks in [[X-Ray]]."
---
name: "--editor-caret-color"
group: Editor text
level: specific
light: "var(--ui-accent-color)"
derivesFrom:
- "--ui-accent-color"
since: "0.3.6"
stability: stable
description: "The text cursor."
---
name: "--editor-selection-background-color"
group: Editor text
level: specific
light: "color-mix(in srgb, var(--ui-accent-color) 25%, var(--root-background-color))"
derivesFrom:
- "--ui-accent-color"
- "--root-background-color"
since: "0.3.6"
stability: stable
description: "Selected text."
---
name: "--editor-highlight-background-color"
group: Editor text
level: specific
light: "var(--highlight-color)"
derivesFrom:
- "--highlight-color"
since: "0.3.6"
stability: stable
description: "`==Highlighted==` text and matches in picker descriptions."
---
name: "--editor-search-match-background-color"
group: Editor text
level: specific
light: "color-mix(in srgb, var(--highlight-color) 70%, transparent)"
derivesFrom:
- "--highlight-color"
since: "edge"
stability: experimental
description: "Matches of the find bar (Mod-f) in the page."
---
name: "--editor-search-match-selected-background-color"
group: Editor text
level: specific
light: "var(--highlight-color)"
derivesFrom:
- "--highlight-color"
since: "edge"
stability: experimental
description: "The current match of the find bar, a stronger version of the other matches."
---
name: "--editor-widget-background-color"
group: Editor text
level: specific
light: "var(--ui-accent-surface-color)"
derivesFrom:
- "--ui-accent-surface-color"
since: "0.6.0"
stability: stable
description: "Widgets in the page: borders, headers and menus of `${...}` results and linked mentions."
---
name: "--editor-external-edit-color"
group: Editor text
level: specific
light: "var(--tone-warning-soft)"
derivesFrom:
- "--tone-warning-soft"
since: "2.11.0"
stability: experimental
description: "Background of text another device or tool just changed. Experimental because [[Collaboration]] is experimental."
---
name: "--editor-external-caret-color"
group: Editor text
level: specific
light: "var(--tone-warning)"
derivesFrom:
- "--tone-warning"
since: "2.11.0"
stability: experimental
description: "Cursor of another device or tool editing the page. Experimental because [[Collaboration]] is experimental."
```


```#theme-variable
name: "--editor-panels-bottom-color"
group: Editor panels and completion
level: specific
light: "var(--root-color)"
derivesFrom:
- "--root-color"
since: "0.3.6"
stability: stable
description: "Text of the find/replace bar and Vim command line."
---
name: "--editor-panels-bottom-background-color"
group: Editor panels and completion
level: specific
light: "var(--ui-accent-surface-color)"
derivesFrom:
- "--ui-accent-surface-color"
since: "0.3.6"
stability: stable
description: "Their background."
---
name: "--editor-panels-bottom-border-color"
group: Editor panels and completion
level: specific
light: "var(--ui-surface-border-color)"
derivesFrom:
- "--ui-surface-border-color"
since: "0.3.6"
stability: stable
description: "Line above them."
---
name: "--editor-panels-bottom-input-background-color"
group: Editor panels and completion
level: specific
light: "var(--root-background-color)"
derivesFrom:
- "--root-background-color"
since: "2.2.0"
stability: stable
description: "Their text fields."
---
name: "--editor-completion-selected-background-color"
group: Editor panels and completion
level: specific
light: "var(--tone-accent-soft)"
derivesFrom:
- "--tone-accent-soft"
since: "edge"
stability: experimental
description: "The selected autocomplete option."
---
name: "--editor-completion-selected-color"
group: Editor panels and completion
level: specific
light: "var(--ui-accent-text-color)"
derivesFrom:
- "--ui-accent-text-color"
since: "edge"
stability: experimental
description: "Text of the selected autocomplete option."
---
name: "--editor-completion-detail-color"
group: Editor panels and completion
level: specific
light: "color-mix(in srgb, var(--root-color), var(--subtle-color) 72%)"
derivesFrom:
- "--root-color"
- "--subtle-color"
since: "0.3.6"
stability: stable
description: "Detail text next to an autocomplete option."
---
name: "--editor-completion-detail-selected-color"
group: Editor panels and completion
level: specific
light: "var(--editor-completion-selected-color)"
derivesFrom:
- "--editor-completion-selected-color"
since: "0.3.6"
stability: stable
description: "Detail text of the selected option."
```


```#theme-variable
name: "--editor-heading-color"
group: Headings, lists and tasks
level: specific
light: "var(--root-color)"
derivesFrom:
- "--root-color"
since: "0.3.6"
stability: stable
description: "Heading text."
---
name: "--editor-heading-meta-color"
group: Headings, lists and tasks
level: specific
light: "var(--meta-color)"
derivesFrom:
- "--meta-color"
since: "0.3.6"
stability: stable
description: "The `#` marks of a heading."
---
name: "--editor-list-bullet-color"
group: Headings, lists and tasks
level: specific
light: "color-mix(in srgb, var(--ui-accent-muted-color) 65%, var(--root-background-color))"
derivesFrom:
- "--ui-accent-muted-color"
- "--root-background-color"
since: "0.3.6"
stability: stable
description: "List bullets and numbers."
---
name: "--editor-line-meta-color"
group: Headings, lists and tasks
level: specific
light: "var(--meta-subtle-color)"
derivesFrom:
- "--meta-subtle-color"
since: "0.3.6"
stability: stable
description: "List markup on the line with the cursor."
---
name: "--editor-ruler-color"
group: Headings, lists and tasks
level: specific
light: "var(--ui-surface-border-color)"
derivesFrom:
- "--ui-surface-border-color"
since: "0.3.6"
stability: stable
description: "Horizontal rules (`---`)."
---
name: "--editor-task-marker-color"
group: Headings, lists and tasks
level: specific
light: "var(--meta-color)"
derivesFrom:
- "--meta-color"
since: "0.3.6"
stability: stable
description: "Task checkbox markup."
---
name: "--editor-task-state-color"
group: Headings, lists and tasks
level: specific
light: "var(--subtle-color)"
derivesFrom:
- "--subtle-color"
since: "0.4.0"
stability: stable
description: "Custom task states, such as `[DOING]`."
```


```#theme-variable
name: "--editor-link-color"
group: Editor links and tags
level: specific
light: "var(--link-color)"
derivesFrom:
- "--link-color"
since: "0.3.6"
stability: stable
description: "Markdown links and named anchors."
---
name: "--editor-link-url-color"
group: Editor links and tags
level: specific
light: "var(--link-color)"
derivesFrom:
- "--link-color"
since: "0.3.6"
stability: stable
description: "A bare URL in a link's markup."
---
name: "--editor-link-meta-color"
group: Editor links and tags
level: specific
light: "var(--meta-subtle-color)"
derivesFrom:
- "--meta-subtle-color"
since: "0.3.6"
stability: stable
description: "The URL part of a Markdown link while you edit it."
---
name: "--editor-naked-url-color"
group: Editor links and tags
level: specific
light: "var(--link-color)"
derivesFrom:
- "--link-color"
since: "0.3.6"
stability: stable
description: "URLs written without link syntax."
---
name: "--editor-wiki-link-page-color"
group: Editor links and tags
level: specific
light: "var(--link-color)"
derivesFrom:
- "--link-color"
since: "0.3.6"
stability: stable
description: "Wiki links to existing pages."
---
name: "--editor-wiki-link-page-missing-color"
group: Editor links and tags
level: specific
light: "var(--link-missing-color)"
derivesFrom:
- "--link-missing-color"
since: "0.3.6"
stability: stable
description: "Wiki links to pages that don't exist yet."
---
name: "--editor-wiki-link-page-invalid-color"
group: Editor links and tags
level: specific
light: "var(--link-invalid-color)"
derivesFrom:
- "--link-invalid-color"
since: "2.0.0-rc1"
stability: stable
description: "Invalid and ambiguous wiki links."
---
name: "--editor-wiki-link-page-background-color"
group: Editor links and tags
level: specific
light: "transparent"
since: "0.3.6"
stability: stable
description: "Faint background behind wiki links."
---
name: "--editor-link-text-decoration"
group: Editor links and tags
level: specific
light: "underline 1.5px color-mix(in srgb, var(--ui-accent-text-color) 40%, transparent)"
derivesFrom:
- "--ui-accent-text-color"
since: "edge"
stability: experimental
description: "Decoration of wiki links and bare URLs, in the editor and in widgets. `underline` draws them like links written with `[text](url)`, which are always underlined."
---
name: "--editor-hashtag-background-color"
group: Editor links and tags
level: specific
light: "var(--ui-accent-muted-soft-color)"
derivesFrom:
- "--ui-accent-muted-soft-color"
since: "0.3.6"
stability: stable
description: "Hashtag pills."
---
name: "--editor-hashtag-color"
group: Editor links and tags
level: specific
light: "var(--ui-label-color)"
derivesFrom:
- "--ui-label-color"
since: "0.3.6"
stability: stable
description: "Hashtag text."
---
name: "--editor-hashtag-border-color"
group: Editor links and tags
level: specific
light: "transparent"
since: "0.3.6"
stability: stable
description: "Hashtag pill border."
---
name: "--editor-hashtag-border-radius"
group: Editor links and tags
level: specific
light: "99px"
since: "edge"
stability: experimental
description: "Corner radius of hashtag pills, in the editor and in pickers. A large value such as `1em` gives round pills."
---
name: "--editor-at-mention-color"
group: Editor links and tags
level: specific
light: "var(--ui-accent-color)"
derivesFrom:
- "--ui-accent-color"
since: "2.11.0"
stability: experimental
description: "`@name` mentions. Experimental because [[At-Mention]] is experimental."
---
name: "--editor-at-mention-background-color"
group: Editor links and tags
level: specific
light: "color-mix(in srgb, var(--editor-at-mention-color) 11%, transparent)"
derivesFrom:
- "--editor-at-mention-color"
since: "2.11.0"
stability: experimental
description: "Background of mentions. Experimental because [[At-Mention]] is experimental."
---
name: "--editor-at-mention-border-color"
group: Editor links and tags
level: specific
light: "color-mix(in srgb, var(--editor-at-mention-color) 30%, transparent)"
derivesFrom:
- "--editor-at-mention-color"
since: "2.11.0"
stability: experimental
description: "Border of mentions. Experimental because [[At-Mention]] is experimental."
---
name: "--editor-at-mention-signature-color"
group: Editor links and tags
level: specific
light: "var(--subtle-color)"
derivesFrom:
- "--subtle-color"
since: "2.11.0"
stability: experimental
description: "The mark of a signature. Experimental because [[Authorship]] is experimental."
---
name: "--editor-page-var-tag-color"
group: Editor links and tags
level: specific
light: "var(--ui-label-color)"
derivesFrom:
- "--ui-label-color"
since: "edge"
stability: experimental
description: "Page Lua variable names. Experimental because [[Space Lua/Page Lua]] is experimental."
---
name: "--editor-page-var-tag-background-color"
group: Editor links and tags
level: specific
light: "var(--ui-accent-muted-soft-color)"
derivesFrom:
- "--ui-accent-muted-soft-color"
since: "edge"
stability: experimental
description: "Background of Page Lua variable names. Experimental because [[Space Lua/Page Lua]] is experimental."
```


```#theme-variable
name: "--editor-meta-color"
group: Markup and frontmatter
level: specific
light: "var(--meta-color)"
derivesFrom:
- "--meta-color"
since: "0.3.6"
stability: stable
description: "Markup while you edit, such as `**` and `[[`."
---
name: "--editor-struct-color"
group: Markup and frontmatter
level: specific
light: "var(--meta-color)"
derivesFrom:
- "--meta-color"
since: "0.3.6"
stability: stable
description: "Structural markup. Nothing in the editor carries its `.sb-struct` class at the moment."
---
name: "--editor-directive-color"
group: Markup and frontmatter
level: specific
light: "var(--subtle-color)"
derivesFrom:
- "--subtle-color"
since: "0.3.6"
stability: stable
description: "Text of a `${...}` expression while you edit it."
---
name: "--editor-directive-mark-color"
group: Markup and frontmatter
level: specific
light: "#6c0101"
dark: "#ba0303"
since: "0.7.0"
stability: stable
description: "The `${` and `}` marks."
---
name: "--editor-directive-background-color"
group: Markup and frontmatter
level: specific
light: "color-mix(in srgb, var(--meta-subtle-color) 8%, transparent)"
derivesFrom:
- "--meta-subtle-color"
since: "0.3.6"
stability: stable
description: "Background of a line with a `${...}` expression being edited."
---
name: "--editor-frontmatter-background-color"
group: Markup and frontmatter
level: specific
light: "var(--ui-accent-surface-color)"
derivesFrom:
- "--ui-accent-surface-color"
since: "0.3.6"
stability: stable
description: "Frontmatter, and the frontmatter form."
---
name: "--editor-frontmatter-color"
group: Markup and frontmatter
level: specific
light: "var(--subtle-color)"
derivesFrom:
- "--subtle-color"
since: "0.3.6"
stability: stable
description: "Frontmatter text."
---
name: "--editor-frontmatter-marker-color"
group: Markup and frontmatter
level: specific
light: "color-mix(in srgb, var(--meta-color) 50%, transparent)"
dark: "var(--root-color)"
derivesFrom:
- "--meta-color"
since: "0.3.6"
stability: stable
description: "The `---` lines around frontmatter, and object form labels."
```


```#theme-variable
name: "--editor-blockquote-background-color"
group: Blocks
level: specific
light: "transparent"
since: "0.3.6"
stability: stable
description: "Quotes."
---
name: "--editor-blockquote-color"
group: Blocks
level: specific
light: "var(--subtle-color)"
derivesFrom:
- "--subtle-color"
since: "0.3.6"
stability: stable
description: "Quote text."
---
name: "--editor-blockquote-border-color"
group: Blocks
level: specific
light: "color-mix(in srgb, var(--ui-accent-muted-color) 60%, var(--root-background-color))"
derivesFrom:
- "--ui-accent-muted-color"
- "--root-background-color"
since: "0.3.6"
stability: stable
description: "The bar beside a quote."
---
name: "--editor-comment-background-color"
group: Blocks
level: specific
light: "color-mix(in srgb, var(--subtle-background-color) 50%, transparent)"
derivesFrom:
- "--subtle-background-color"
since: "2.11.0"
stability: stable
description: "[[Markdown/Comment|Comment]] blocks."
---
name: "--editor-comment-border-color"
group: Blocks
level: specific
light: "color-mix(in srgb, var(--root-background-color), var(--meta-subtle-color) 72.5%)"
derivesFrom:
- "--root-background-color"
- "--meta-subtle-color"
since: "2.11.0"
stability: stable
description: "Outline of comment blocks."
---
name: "--editor-code-background-color"
group: Blocks
level: specific
light: "color-mix(in srgb, var(--ui-accent-muted-color) 6%, transparent)"
derivesFrom:
- "--ui-accent-muted-color"
since: "0.3.6"
stability: stable
description: "Inline code and code blocks."
---
name: "--editor-code-info-color"
group: Blocks
level: specific
light: "var(--subtle-color)"
derivesFrom:
- "--subtle-color"
since: "0.3.6"
stability: stable
description: "The language name of a code block."
---
name: "--editor-code-inserted-color"
group: Blocks
level: specific
light: "var(--success-color)"
derivesFrom:
- "--success-color"
since: "2.5.0"
stability: stable
description: "Added lines in diffs and revisions."
---
name: "--editor-code-inserted-bg"
group: Blocks
level: specific
light: "var(--tone-success-soft)"
derivesFrom:
- "--tone-success-soft"
since: "2.5.0"
stability: stable
description: "Background of added lines."
---
name: "--editor-code-deleted-color"
group: Blocks
level: specific
light: "var(--danger-color)"
derivesFrom:
- "--danger-color"
since: "2.5.0"
stability: stable
description: "Removed lines in diffs and revisions."
---
name: "--editor-code-deleted-bg"
group: Blocks
level: specific
light: "var(--tone-danger-soft)"
derivesFrom:
- "--tone-danger-soft"
since: "2.5.0"
stability: stable
description: "Background of removed lines."
---
name: "--editor-table-head-background-color"
group: Blocks
level: specific
light: "var(--ui-accent-surface-color)"
derivesFrom:
- "--ui-accent-surface-color"
since: "0.3.6"
stability: stable
description: "Table header row."
---
name: "--editor-table-head-color"
group: Blocks
level: specific
light: "var(--ui-label-color)"
derivesFrom:
- "--ui-label-color"
since: "0.3.6"
stability: stable
description: "Table header text."
---
name: "--editor-table-even-background-color"
group: Blocks
level: specific
light: "color-mix(in srgb, var(--ui-accent-muted-color) 3%, var(--root-background-color))"
derivesFrom:
- "--ui-accent-muted-color"
- "--root-background-color"
since: "0.3.6"
stability: stable
description: "Every other table row."
```


```#theme-variable
name: "--admonition-color"
group: Admonitions
level: specific
since: "0.7.6"
stability: stable
description: "Color of an [[Markdown/Admonition|admonition]]: its bar, title and icon. Set on `.sb-admonition[admonition=\"…\"]`, per type; the built-in types use tones."
---
name: "--admonition-icon"
group: Admonitions
level: specific
since: "0.7.6"
stability: stable
description: "An admonition's icon, as a `url(…)` image used as a mask. Set per type, like `--admonition-color`."
```
