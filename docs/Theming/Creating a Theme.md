---
description: "Create a theme page, set its variables, and share it as a library."
tags: customization
references:
- plug-api/lib/themes.ts
- client/tooling.ts
- client/space_theme.ts
- plugs/index/lint.ts
- libraries/Library/Std/Themes/SilverBullet Dark.md
---
A theme is an ordinary page under `Library/` with the `meta/theme` tag, some frontmatter, and one or more `space-style` blocks. Most themes only set variables.

# A minimal theme
Create a page such as `Library/myuser/Themes/Sepia`:

    ---
    tags: meta/theme
    displayName: Sepia
    description: Warm paper with brown ink.
    scheme: light
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

After it saves, Sepia shows up in ${widgets.commandButton("Theme: Select")} and under Configuration → Appearance → Theme. Everything you didn’t set, such as the top bar, buttons, pickers and hashtags, derives from these few colors.

# Frontmatter
* `tags`: _must_ include `meta/theme`.
* `scheme`: `light` or `dark`. Required: a page without a valid scheme isn’t a theme. Its `space-style` blocks are ignored (its `space-lua` still runs), and the lint error on `scheme` says why. It sets `data-sb-scheme` on `html` and the browser’s `color-scheme`, and picks the built-in theme yours builds on.
* `displayName`: the name in pickers. Defaults to the last part of the page name.
* `description`: shown in pickers and queries.
* `counterpart`: a wiki link to the theme ${widgets.commandButton("Theme: Toggle Light/Dark")} switches to, such as `"[[Library/myuser/Themes/Sepia Night]]"`.
* `fonts`: font suggestions, see [[#Fonts|Fonts]] below.

Mistakes in this frontmatter, such as a misspelled `scheme`, show as lint warnings on the page.

The page name is the theme’s identity: the space setting and device choices store it. If you rename or move a theme, spaces and devices that picked it fall back to the default.

# Build on a built-in theme
A theme starts from the built-in theme with the same scheme. A light theme starts from SilverBullet Light, the built-in defaults. A dark theme starts from [[^Library/Std/Themes/SilverBullet Dark]], so you only set what you want different, and every color you leave alone is already right for a dark page.

# Base and specific variables
[[Theming/Variables]] lists every variable. **Base variables** are the palette: page and text colors, the accent, link colors, tones and the code palette. Start with these. **Specific variables** color one part of the interface, and derive from the base ones: the top bar mixes the page and subtle colors, alerts and notifications use the tones, hashtags and the selected completion use the strong accent.

Set a specific variable only when its derived color doesn’t work for your palette. A dark theme that needs many specific variables is a sign a derivation is missing: please [report it](https://github.com/silverbulletmd/silverbullet/issues).

The derivations are computed on `html`. Set base variables there: a base variable set on another element changes that element, but not the specific variables computed from it. For example, `#sb-top { --root-color: red; }` doesn’t change the top bar’s text, because `--top-color` was already computed on `html`. Set `--top-color` instead, or set `--root-color` on `html`.

One case to watch: `--ui-accent-strong-contrast-color` (text on hashtag pills and the selected completion) assumes `--ui-accent-strong-color` comes out dark. If your accent is very light, set both yourself.

The six tones, `--tone-success`, `--tone-warning`, `--tone-danger`, `--tone-info`, `--tone-neutral` and `--tone-accent` with their `-soft` variants, are also meant for people’s own styles and widgets. Give them values that read well on your background.

# Your own variables
If your theme needs variables of its own, prefix them with the theme’s name, such as `--paper-ink` for a theme called Paper, so they can’t clash with SilverBullet’s or another theme’s:

```css
html {
  --paper-ink: #3b2f25;
  --root-color: var(--paper-ink);
  --editor-heading-color: var(--paper-ink);
  /* Hashtags as round pills */
  --editor-hashtag-border-radius: 1em;
}

/* One tag stands out */
.sb-hashtag[data-tag-name="urgent"] {
  font-weight: bold;
}
```

When you style elements rather than variables, stick to the selectors on [[Theming/Selectors]]. Anything else may change without notice.

# Fonts
A theme suggests fonts instead of setting them. Use the `fonts` key with the font keys from [[Fonts]] (`editor` and `code`) and `editorSize` in pixels, from 10 to 48. The interface always uses Lora, so a `ui` suggestion has no effect:

```yaml
fonts:
  editor: lora
  editorSize: 19
```

A suggestion applies only to what the space leaves unset in Configuration or [[^Library/Config]], and only when that font is installed. SilverBullet warns when a theme’s `space-style` sets `--ui-font`, `--editor-font`, `--editor-monospace-font` or `--editor-font-size`.

# Light and dark families
A light and a dark theme that belong together are each other’s `counterpart`. Each is its own page with its own `scheme`, and **Theme: Toggle Light/Dark** switches between them. [[#Sharing a theme|Sharing a theme]] shows a complete family.

# Sharing a theme
A theme is shared as a [[Library]]. See [[Library/Development|Develop a library]] for publishing.

**One theme:** the library page is the theme. Tag it with both tags:

```yaml
name: Library/myuser/Themes/Sepia
tags: meta/library meta/theme
scheme: light
```

**A family:** the library page lists the theme pages under `files`, and each of those pages is a theme of its own. The library page `Library/myuser/Themes/Paper`:

    ---
    name: Library/myuser/Themes/Paper
    tags: meta/library
    description: Warm paper colors, light and dark.
    files:
    - Paper/Light.md
    - Paper/Night.md
    ---
    Paper comes in a light and a dark theme. Pick one in Configuration → Appearance → Theme.

`Library/myuser/Themes/Paper/Light`:

    ---
    tags: meta/theme
    displayName: Paper
    scheme: light
    counterpart: "[[Library/myuser/Themes/Paper/Night]]"
    ---
    ```space-style
    html {
      --root-background-color: #faf6ee;
      --root-color: #3b2f25;
      --ui-accent-color: #a8432f;
    }
    ```

`Library/myuser/Themes/Paper/Night`, the dark one:

    ---
    tags: meta/theme
    displayName: Paper Night
    scheme: dark
    counterpart: "[[Library/myuser/Themes/Paper/Light]]"
    ---
    ```space-style
    html {
      --root-background-color: #1f1b17;
      --root-color: #e8dfd2;
      --ui-accent-color: #e08a6c;
    }
    ```

Quote the `counterpart` link: unquoted, YAML reads `[[…]]` as a list.

**Using a font library:** a theme that relies on a font requires the font’s library, rather than bundling the font files. List it under `requires` on the theme’s library page, and suggest the font in each theme’s `fonts` with the font library’s key (such as `lora`):

```yaml
name: Library/myuser/Themes/Paper
tags: meta/library
requires:
- github:silverbulletmd/silverbullet-libraries@main/Library/silverbulletmd/Fonts/Lora.md
```

Installing the theme then installs the font library too, unless it is already installed, and the font can’t be removed while the theme is installed. For a font library in the same repository as the theme, a relative path such as `../Fonts/Lora.md` works too. See [[Library#Libraries that require other libraries]]. Only a font that has no library of its own needs bundling: put its files under `files` and register it as described in [[Fonts#Writing a font library|Writing a font library]].

# Checking your theme
* Switch to it with **Theme: Select**, and back with **Use space default**.
* Look at pickers, the command palette, notifications, a table, code blocks, frontmatter and hashtags: most of the derived colors show up there.
* The [[Workbench/Code/Styles|Space Style]] section of the Workbench shows your theme’s blocks, and whether the browser parsed them.
* `theme.getActive()` in the [[Workbench/Console]] shows which theme is on screen, see [[API/theme|the theme API]].
