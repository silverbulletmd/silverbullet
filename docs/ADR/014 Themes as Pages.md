---
tags: adr
status: accepted
date: "2026-11-13"
deciders: "[[Zef Hemel]]"
owner: "[[Zef Hemel]]"
lastReviewed: "2026-11-13"
related:
  - "[[ADR/005 Space Lua]]"
  - "[[ADR/012 Tooling Lives in Library]]"
references:
- plug-api/lib/themes.ts
- client/space_theme.ts
- client/styles/theme.scss
- client/styles/_dark_palette.scss
- client/styles/theme_variables.ts
- client/styles/theme_docs.test.ts
- client/sandbox/theme_message.ts
- client/plugos/syscalls/theme.ts
- libraries/Library/Std/Themes/SilverBullet Light.md
- libraries/Library/Std/Themes/SilverBullet Dark.md
---
# Context
SilverBullet’s look used to be customized in two ways: a global dark mode flag swapped a built-in set of colors, and [[Space Style]] let you override _anything_ with CSS. That gave no unit you could share: a “theme” was a pile of `space-style` blocks that you copied into your space, that targeted whatever classes and variables happened to exist, and that broke when those changed. Dark mode was a per-device switch, unrelated to any of it, so a style written for light mode simply leaked into dark mode.

We wanted themes people can pick, install, write and share, without growing a second extension mechanism next to [[Library|libraries]], and without freezing the client’s internal CSS.

# Decision
**A theme is a page.** It lives under `Library/`, is tagged [[Tag/meta/theme|meta/theme]], and declares its `scheme` (`light` or `dark`) in frontmatter. Its `space-style` blocks apply only while it is the active theme. Being a library, it is installed, updated, shared and required like any other library, with no theme-specific distribution channel.

**Light and dark are properties of a theme, not a mode.** Dark mode means picking a dark theme. A theme names its `counterpart`, and **Theme: Toggle Light/Dark** switches to it. The old dark mode flag is migrated to the matching built-in theme (`migrateDarkMode`).

**The built-in themes are the base layer.** SilverBullet Light and SilverBullet Dark are ordinary theme pages in `Library/Std/Themes`, but their colors are compiled into the client (`theme.scss`, `_dark_palette.scss`), so the editor is styled before any page loads. Any other theme is applied *on top of* the built-in theme with the same scheme, so it only states what differs.

**The precedence is fixed:** the client’s own CSS (variable defaults declared on `:where(html)`, so with zero specificity), then fonts, then the active theme’s blocks (in `#sb-theme`), then the `accentColor` setting, then the user’s own Space Style. The user always gets the last word without copying the theme.

**Which theme applies:** this device’s choice, else the space’s `theme` setting, else the built-in theme matching the operating system’s color scheme (`resolveTheme`). The active theme is exposed on `html` as `data-sb-theme` (its page name) and `data-sb-scheme`, which is what user styles target.

**Fonts are separate.** A theme may *suggest* fonts in its `fonts` frontmatter, but fonts are their own setting ([[Fonts]]), installed as font libraries a theme can `require`, rather than bundled into themes.

**The theme reaches everything that renders.** The resolved theme is cached in `localStorage` so a reload paints in the right theme before the space loads, and it is posted to sandboxed widget and panel iframes (`theme_message.ts`), which follow later changes. Scripts read and set it through the [[API/theme|theme API]].

# Consequences
## Positive
* **A theme is shareable and installable** through the existing library mechanism, including requirements on font libraries and update checks.
* **Small themes.** Building on the built-in theme of the same scheme, plus derived variables, means a useful theme is a handful of colors.
* **Light and dark stay coherent.** Styles can target a scheme or one theme explicitly instead of leaking across modes.
* **The client can evolve its CSS.** Only the documented variables and selectors are promised, and the tests flag any change that would break that promise.

## Negative / trade-offs
* **The built-in palettes live in two places:** compiled into the client, and represented by their theme pages, which carry metadata but no styles. Changing a built-in color means changing the client, not the page.
* **The variable list is now an API.** Renaming or removing a stable variable is a breaking change for third-party themes, so it needs a deprecation path. The docs and their tests must be kept in sync with every styling change.

# Alternatives considered
* **Keep a global dark mode flag plus Space Style.** Rejected: nothing to share or pick, and every style has to handle both modes itself.
* **A separate theme format or registry** (JSON palettes, a theme store). Rejected: it duplicates what libraries already do for distribution, and a page with `space-style` blocks is already the most flexible format SilverBullet has.
* **Every theme complete on its own**, without a built-in base. Rejected: themes would have to set every variable, and break whenever the client adds one.
