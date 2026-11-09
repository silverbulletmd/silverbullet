---
description: "Reusable text with Lua expressions that supply values when it runs."
tags: glossary
references:
- libraries/Library/Std/APIs/Template.md
- client/space_lua/stdlib.ts
---
A template in SilverBullet is a string that contains `${expression}` placeholders, which get evaluated using [[Space Lua]]. When a template runs, its placeholders are evaluated. Page and slash templates insert the resulting text into a page. That text stays saved until you edit it. A template called from a page expression renders a live result instead. See [[Guide/When Results Update]] for update behavior.

They are often used in [[Slash Templates]] and [[Page Template]].

# Creating templates
Put reusable definitions in a `space-lua` block on a page under `Library/` in your own space, then run `System: Reload`. Use `template.new` to create a template function from a string. By convention, template strings use `[==[` and `]==]` as delimiters:

```space-lua
templates.greet = template.new[==[Hello, ${name}!]==]
```

After loading the definition, put this expression in a page in the same space. It renders “Hello, Sam!”:

```markdown
${templates.greet {name = "Sam"}}
```

Templates can embed widgets. A template that interpolates a widget, like `template.new[==[* ${name} ${widgets.button("Open", open)}]==]`, returns a [[API/widget#Combining widgets with text|fragment]] instead of a string. It renders anywhere, including in query results, but can’t be used as text (a page name, inserted text): use `widget.toMarkdown` there.

Interpolated query results and lists render the way a page-level `${...}` renders them: a table or one item per line, not a raw Lua table.

# Rendering collections
The preferred pattern is to apply a template to each row directly in your query’s `select` clause:

```space-lua
query[[
  from p = index.pages()
  order by p.lastModified desc
  limit 5
  select templates.pageItem(p)
]]
```

The older `template.each(collection, template)` API still works (see [[API/template#template.each(collection, template)]]), but the `select`-based form is more compact and composes naturally with the rest of [[Space Lua/Integrated Query]].

# Pre-built templates
The standard library provides several commonly used templates in the `templates` table:

* `templates.pageItem`: Renders a page as `* [[pageName]]`.
* `templates.fullPageItem`: Similar to `pageItem` but rendering the full page name (including folders).
* `templates.taskItem`: Renders a task as a togglable checkbox item with a link to its source so that it can update.
* `templates.itemItem`: Renders a list item with a link to its source.
* `templates.paragraphItem`: Renders a paragraph with a link to its source.
* `templates.tagItem`: Renders a tag as a linked hashtag.

# Page templates
[[Page Template|Page templates]] are pages tagged with `#meta/template/page`. They serve as blueprints for creating new pages — you can configure them with suggested names, keyboard shortcuts, and commands.

# Slash templates
[[Slash Templates]] are pages tagged with `#meta/template/slash`. They define [[Slash Command|slash commands]] that insert templated content at the cursor position. The last component of the page name becomes the slash command name.

See also: [[API/template]], [[Page Template]], [[Slash Templates]], [[Space Lua]]
