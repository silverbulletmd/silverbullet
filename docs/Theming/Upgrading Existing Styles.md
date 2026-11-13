---
description: "What to check when your Space Style themed SilverBullet before 3.0."
tags: customization
references:
- client/styles/theme.scss
- client/space_theme.ts
- client/plugos/syscalls/editor.ts
- plug-api/lib/panel_styles.ts
---
With proper [[Theming]] support landing in SilverBullet core, a few pointers for those who “hacked” it in the past.

# Checklist
1. **Review colors you didn’t set.** Most specific variables now derive from a few base colors. If your style set `--root-background-color` and the accent but not, say, the top bar or the pickers, those now follow your colors instead of the old defaults. That usually looks better; check that it does for you. [[Theming/Variables]] gives each variable’s default, with the base variables it uses.
2. **Plain `html { … }` rules now apply in dark themes too.** Before, the built-in dark mode rules out-ranked a plain `html` rule, so a variable that the dark palette also set only changed in light mode. Now any rule beats the built-in defaults. If a rule was meant for light mode only, wrap it in `html[data-sb-scheme="light"] { … }`. Rules under `html[data-theme="dark"]` keep working as before.
3. **Dark mode is picking a dark theme.** The **Editor: Toggle Dark Mode** command is gone. Use **Theme: Toggle Light/Dark**, or **Theme: Select** and Configuration → Appearance → Theme, see [[Theming#Picking a theme|Picking a theme]]. A device where you switched dark mode on or off keeps that look: unless the space’s theme already matches, the device gets SilverBullet Dark or Light as its own theme.
4. **Consider turning your style into a theme.** Put it on its own page under `Library/`, tagged `meta/theme` with a `scheme`, as described in [[Theming/Creating a Theme]]. It then shows up in the theme picker, applies only while it’s picked, and doesn’t stack on top of other themes. If you had light and dark variants, make two themes and link them with `counterpart`.
5. **Specificity hacks can go.** `!important`, `html:root` and doubled `[data-theme]` selectors still work, but SilverBullet’s defaults no longer need to be out-ranked. Plain `html { … }` is enough.
6. **Switch `data-theme` to `data-sb-scheme`.** `html[data-sb-scheme="dark"]` and `html[data-sb-scheme="light"]` are the way to target dark or light themes now. `data-theme` has the same value and still works for now, but is deprecated.

# Removed variables
These are gone, mostly because nothing used them any more: `--action-button-active-color`, `--editor-command-button-background-color`, `--editor-command-button-border-color`, `--editor-command-button-color`, `--editor-command-button-hover-background-color`, `--editor-command-button-meta-color`, `--editor-panels-bottom-button-active-background-image`, `--editor-panels-bottom-button-background-image` (the find bar's buttons now look like every other button), `--editor-wiki-link-color`, `--modal-hint-inactive-background-color`, `--modal-hint-inactive-color` and `--notifications-background-color`. Setting them does nothing.

# For script and plug authors
* `editor.setUiOption("darkMode", value)` still works but is deprecated, and logs a warning. When the active theme’s scheme doesn’t match, it picks a theme for this device: the active theme’s counterpart, or SilverBullet Light or Dark. Use the [[API/theme|theme API]] instead, for example `theme.setDeviceTheme("Library/Std/Themes/SilverBullet Dark")`.
* `editor.getUiOption("darkMode")` still returns whether the active theme is dark.
* To find out whether the page is dark, read `data-sb-scheme` on `html` (`data-theme` is a deprecated alias). Don’t set either: SilverBullet sets them from the active theme.
* Panels and iframes that link `.client/components.css` themselves, without the `customStyles` UI option, now get only `data-sb-scheme`, `data-theme` and `color-scheme`, not the dark colors. Build their stylesheet with `panelStyles()` from `@silverbulletmd/silverbullet/ui`, which includes a `<div id="sb-theme" hidden>` that the panel fills with the theme, and refills when the theme changes.
