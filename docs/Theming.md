---
description: "Select a theme for your space, adjust it, or even create your own."
tags: customization glossary
references:
- client/space_theme.ts
- plug-api/lib/themes.ts
- client/plugos/syscalls/theme.ts
- client/workbench/configuration/theme_select.tsx
- client/styles/theme.scss
- libraries/Library/Std/Themes/SilverBullet Light.md
- libraries/Library/Std/Themes/SilverBullet Dark.md
---
A theme sets SilverBullet’s colors, and can suggest fonts. SilverBullet ships two themes by default (SilverBullet Light and SilverBullet Dark). You can install more as [[Library|libraries]] or write your own. The **Classic** library, in the SilverBullet library repository, brings back the original look (iA Writer Mono, a grey top bar, tinted links) as **SilverBullet Classic** and **SilverBullet Classic Dark**.

As many things, a theme is a page under `Library/` tagged [[Tag/meta/theme|meta/theme]]. Its `space-style` blocks apply only while it is the active theme. Whether a theme is light or dark is a property of the theme: dark mode means picking a dark theme.

Themes installed in this space:

${query[[
  from p = index.pages("meta/theme")
  order by p.displayName
  select {theme=markdown.link(p.name, p.displayName or p.name), scheme=p.scheme, description=p.description}
]]}

# Picking a theme
* **For the whole space:** [[Workbench/Configuration]] → **Appearance** → **Theme**.
* **For this device only:** ${widgets.commandButton("Theme: Select")} picks a theme for this client only.
* **Switching between light and dark:** ${widgets.commandButton("Theme: Toggle Light/Dark")} switches this device to the active theme’s `counterpart`.

This is how SilverBullet decides the theme to apply:

1. This device’s choice.
2. The space’s `theme` setting.
3. SilverBullet Light, or SilverBullet Dark based on your device’s dark mode.

Scripts can use the [[API/theme|theme API]].

# How styles load
From lowest to highest precedence:

1. SilverBullet’s own CSS. Its variable defaults are the SilverBullet Light colours, declared with zero specificity (`:where(html)`), so any rule of yours overrides them.
2. The fonts chosen under [[Fonts]].
3. The active theme. A theme that isn’t built in is applied on top of the built-in theme with the same scheme, so a dark theme only needs to set what differs from SilverBullet Dark.
4. Your ordinary [[Space Style]] blocks, in their usual order.

The [[Workbench/Code/Styles|Space Style]] section of the Workbench lists theme blocks with the theme they belong to, and greys out those of inactive themes.

# Accent color
**Accent color**, under [[Workbench/Configuration]] → **Appearance**, replaces the active theme's `--ui-accent-color` with any CSS colour, such as `#c2410c`. Leave it empty to keep the theme’s own. Themes that derive their colours from the accent. In [[^Library/Config]]:

```space-lua
config.set("accentColor", "#0f766e")
```

# Customising on top of a theme
Your own [[Space Style]] loads after the theme, so you can adjust any theme without copying it. There are three ways to target a rule:

**All themes:**

```space-style
html {
  --editor-width: 1000px;
}
```

**Light or dark themes:** match `data-sb-scheme`, which is `light` or `dark`.

```space-style
html[data-sb-scheme="dark"] {
  --highlight-color: rgba(255, 200, 0, 0.35);
}
```

**One theme:** match `data-sb-theme`, which holds the theme’s page name. `$=` matches the end of the name, `*=` any part of it, so you don’t need the whole path:

```css
html[data-sb-theme="Library/Std/Themes/SilverBullet Dark"] {
  --ui-accent-color: #e0a050;
}

/* Every theme whose page name ends in /Night */
html[data-sb-theme$="/Night"] {
  --editor-width: 900px;
}

/* Every theme in a Paper family */
html[data-sb-theme*="/Paper/"] {
  --link-color: #8c3b2a;
}
```

Set variables on `html`. A base variable set on another element, say `#sb-top`, changes that element but not the colours derived from it. See [[Theming/Creating a Theme#Base and specific variables|Base and specific variables]].

# What you can rely on
* Every variable on [[Theming/Variables]], each with the release that introduced it and whether it is stable or experimental.
* The selectors on [[Theming/Selectors]].
* Everything else, any other class, id or the structure of the page, is internal and may change in any release.

# Going further
* [[Theming/Creating a Theme]]: make a theme or a family of themes, and share it as a library.
* [[Theming/Upgrading Existing Styles]]: what to check if you styled SilverBullet before themes existed.
* [[Fonts]]: fonts are a separate setting, which themes can only suggest.
