---
description: "The CSS selectors themes and space styles can rely on."
tags: customization
references:
- client/styles/theme_docs.test.ts
- client/editor_ui.tsx
- client/style.ts
- client/codemirror/editor_state.ts
---
Most theming is [[Theming/Variables|variables]]. When a variable doesn’t cover what you want, you can style elements directly. These are the selectors SilverBullet promises to keep. Any other class, id or DOM structure is internal and may change in any release without notice.

A selector here is `stable` when it is safe to build on, `experimental` when the feature it belongs to may still change, or `deprecated` when it still works but has a replacement. **Since** is the first release that had it, or `edge` for the [edge builds](https://github.com/silverbulletmd/silverbullet/releases/tag/edge).

${query[[
  from s = index.objects("theme-selector")
  select template.new[==[* `${selector}`: ${description} _Since ${since}${stability ~= "stable" and (", " .. stability) or ""}._
]==](s)
]]}

# Tips
* Prefer a variable when one exists: it keeps working when the markup changes, and it applies to panels and pickers as well as the editor.
* Scope editor rules with `#sb-main .cm-editor` so they don’t leak into panels and widgets.
* To match a theme or a scheme, combine these with `html[data-sb-theme]` or `html[data-sb-scheme]`, see [[Theming#Customising on top of a theme|Customising on top of a theme]].

# Data
The list above is a query over the `#theme-selector ` objects on [[Theming/Selectors/Data]].
