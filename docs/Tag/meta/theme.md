---
description: Pages that define a theme.
references:
- plug-api/lib/themes.ts
- client/tooling.ts
- libraries/Library/Std/Infrastructure/Root Tags.md
---
A page under `Library/` tagged `meta/theme` is a theme: its `space-style` blocks apply only while it is the active theme, and it shows up in **Theme: Select** and in Configuration → Appearance → Theme. See [[Theming]] for picking themes and [[Theming/Creating a Theme]] for writing one.

SilverBullet reads themes from the pages themselves when it starts, so they work before the index is built. Because they are ordinary pages, you can also query them with `index.pages("meta/theme")`.

## Attributes
Besides the usual [[Tag/page|page]] attributes, a theme page has these in its [[Frontmatter]]:
* `scheme`: `light` or `dark`. Required. A `meta/theme` page without a valid `scheme` isn’t a theme: its `space-style` blocks are ignored (its `space-lua` still runs), and the lint error on `scheme` says why.
* `displayName`: the name shown in pickers. Defaults to the last part of the page name.
* `description`: shown in pickers and queries.
* `counterpart`: a wiki link to the theme **Theme: Toggle Light/Dark** switches to.
* `fonts`: suggested fonts, with `ui`, `editor`, `code` and `editorSize`. See [[Fonts#Notes for theme authors|Notes for theme authors]].

The tag has a [[Schema|schema]] for these attributes, defined in [[^Library/Std/Infrastructure/Root Tags]], so a theme page with a missing or invalid `scheme`, or a `fonts.editorSize` outside 10 to 48, shows lint warnings in its frontmatter. Theme pages get the `droplet` icon.

The themes in this space:

${query[[
  from p = index.pages("meta/theme")
  order by p.name
  select {name=markdown.link(p.name), scheme=p.scheme, counterpart=p.counterpart}
]]}
