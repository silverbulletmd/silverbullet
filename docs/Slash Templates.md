---
description: "Reusable content inserted by slash commands."
tags: glossary
references:
- libraries/Library/Std/Infrastructure/Slash Templates.md
- libraries/Library/Std/Slash Templates/tpl.md
---
Slash templates are a quick way to define [[Slash Command|slash commands]] that insert templated content at the cursor position. They are defined as pages tagged with `#meta/template/slash`. The inserted text is saved in the destination page. Later edits to the template do not change earlier insertions. 

# Creating a slash template
1. Run the `Page: From Template` command
2. Select “Slash Template”
3. Pick a name, the last component of the page name (after the `/` if any) will be used as the slash command’s name. For example, a page named `Library/Slash Template/action-items` creates a `/action-items` slash command. Keep slash templates under `Library/`, so they count as [[Tool Page|tool pages]]. One elsewhere still works, but shows up as regular content.
4. Put the template content in the page body. Lua directives (`${...}`) are supported and will be evaluated when the template is inserted.

Run the `System: Reload` command to activate the slash template.

## Example
A minimal page named `Library/Slash Template/action-items` with this content:

~~~
---
tags: meta/template/slash
description: Insert a standard action items section
---
# Action items
* [ ] |^|
~~~

This creates a `/action-items` slash command that inserts an action items section.

# Configuration
You can configure these optional [[Frontmatter]] keys:

* `displayName`: The label shown in the menu instead of the name, e.g. `Code block` for `/code`. Typing the name keeps working.
* `description`: The description shown in the slash command completion menu
* `icon`: The icon shown in front of it: a [Feather](https://feathericons.com) icon name, an `md-*` editor icon (as on the [[API/markupBar|markup bar]]) or inline `<svg>` markup
* `aliases`: More words that find the command when typed after `/`, e.g. `[divider, separator]`
* `group`: The menu section it’s listed under (see [[API/slashCommand#Groups]]), e.g. `Basic blocks`
* `priority`: Higher priority commands appear earlier in their group
* `block`: How it lands when the line already has text. `insert`: as a block of its own, after the current line (on an empty line, right there). `convert`: the current line turns into it, its text going where `|^|` is (the callouts do this). Without `block`, the template is inserted at the cursor.
* `onlyContexts` (advanced): Only show the command in certain AST node contexts
* `exceptContexts` (advanced): Show the command everywhere _except_ in these AST node contexts

Besides AST node names, contexts can be `@blank` (the line is empty, apart from the `/` you typed), `@hasChildren` (a list item with nested items), `@folded` (a folded line) or `@hasFrontmatter` (the page has frontmatter), as for the [[API/markupBar|markup bar]].

For example, the standard `/hr`:

~~~
---
tags: meta/template/slash
displayName: Divider
description: Insert a horizontal rule
icon: md-horizontal-rule
group: Basic blocks
aliases: [divider, separator, rule, line]
block: insert
exceptContexts: [FencedCode, FrontMatter, LuaDirective]
---
---
~~~

# Currently active slash templates
${query[[
  from p = index.pages("meta/template/slash")
  select templates.fullPageItem(p)
]]}

See also: [[Slash Command]], [[Template]], [[Page Template]]
