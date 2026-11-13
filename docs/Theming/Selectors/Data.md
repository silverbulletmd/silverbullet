---
description: "The theme selector objects that Theming/Selectors lists."
references:
- client/styles/theme_docs.test.ts
---
The `#theme-selector` objects that [[Theming/Selectors]] lists. You can query them yourself with `index.objects("theme-selector")`. Each has:

* `selector`: the CSS selector, such as `#sb-top`.
* `description`: what it matches.
* `since`: the first release that had it, or `edge`.
* `stability`: `stable`, `experimental` or `deprecated`.

A test in `client/styles/theme_docs.test.ts` fails when a class, id or attribute named here disappears from the client.

```#theme-selector
selector: "html[data-sb-scheme]"
description: "`light` or `dark`: the scheme of the active theme. Read it, don’t set it; pick a theme instead."
since: edge
stability: stable
---
selector: "html[data-theme]"
description: "Deprecated alias of `html[data-sb-scheme]`, with the same value. Still works, but switch to `data-sb-scheme`."
since: "0.1.0"
stability: deprecated
---
selector: "html[data-sb-theme]"
description: "The page name of the active theme, such as `Library/Std/Themes/SilverBullet Dark`. Match the end with `$=` or a part with `*=`."
since: edge
stability: stable
---
selector: "#sb-root"
description: "The whole client."
since: "0.1.0"
stability: stable
---
selector: "#sb-top"
description: "The top bar."
since: "0.1.0"
stability: stable
---
selector: "#sb-main"
description: "Everything below the top bar: the editor with the side panels."
since: "0.1.0"
stability: stable
---
selector: "#sb-editor"
description: "The editor area between the side panels."
since: "0.1.0"
stability: stable
---
selector: "#sb-main .cm-editor"
description: "The page editor. Scope editor-only rules with it."
since: "0.2.5"
stability: stable
---
selector: ".sb-panel"
description: "A side or bottom panel."
since: "0.1.0"
stability: stable
---
selector: ".sb-line-h1 … .sb-line-h6"
description: "The line of a heading in the editor, one class per level. `.sb-line-h5` and `.sb-line-h6` came in 0.8.0."
since: "0.1.0"
stability: stable
---
selector: ".sb-hashtag[data-tag-name]"
description: "A hashtag. `data-tag-name` holds the tag without `#`, see [[Space Style#Tag Styling|Tag Styling]]."
since: "0.10.2"
stability: stable
---
selector: ".sb-wiki-link"
description: "The text of a wiki link in the editor."
since: "0.1.0"
stability: stable
---
selector: ".sb-attribute"
description: "An inline `[name: value]` attribute, with `.sb-attribute-name` and `.sb-attribute-value` inside."
since: "2.4.0"
stability: stable
---
selector: ".sb-admonition[admonition]"
description: "An [[Markdown/Admonition|admonition]]. `admonition` holds its type, such as `note`."
since: "0.2.3"
stability: stable
---
selector: ".sb-admonition-type"
description: "The type label of an admonition, which carries its icon. Used to add custom admonitions."
since: "0.8.3"
stability: stable
---
selector: ".sb-line-blockquote"
description: "A line of a quote."
since: "0.1.0"
stability: stable
---
selector: ".sb-line-fenced-code"
description: "A line of a fenced code block."
since: "0.1.0"
stability: stable
---
selector: ".sb-frontmatter"
description: "A line of frontmatter while you edit it."
since: "0.1.3"
stability: stable
---
selector: ".sb-frontmatter-preview"
description: "Frontmatter shown as a form or widget while the cursor is elsewhere."
since: "2.12.0"
stability: stable
---
selector: ".sb-lua-directive-block"
description: "The result of a block-level `${...}` expression, such as a query or widget. What’s inside it is internal."
since: "0.10.2"
stability: stable
---
selector: ".sb-notifications"
description: "The stack of notifications."
since: "0.1.0"
stability: stable
---
selector: ".sb-modal-box"
description: "The box of a picker, prompt or the command palette."
since: "0.2.5"
stability: stable
```
