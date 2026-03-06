---
description: Reusable content with placeholder expressions, used for page creation, slash commands, and more.
tags: glossary
---
A template in SilverBullet is a string that contains `${expression}` placeholders, which get evaluated using [[Space Lua]]. Templates are a mechanism for dynamically rendering content in your pages.

# Creating templates
Use `template.new` to create a template function from a string. By convention, template strings use `[==[` and `]==]` as delimiters:

```lua
templates.greet = template.new[==[Hello, ${name}!]==]
```

Call the template with a table of values:

```lua
${templates.greet {name = "World"}}
```

# Rendering collections with template.each
The most common pattern is using `template.each` to render a list of objects:

```lua
template.each(query[[
  from index.tag "page"
  order by lastModified desc
  limit 5
]], templates.pageItem)
```

`template.each` iterates over the collection and applies the template to each item, concatenating the results.

# Pre-built templates
The standard library provides several commonly used templates in the `templates` table:

| Template | Description |
|---|---|
| `templates.pageItem` | Renders a page as `* [[pageName]]` |
| `templates.fullPageItem` | Similar to `pageItem` but rendering the full page name (including folders) |
| `templates.taskItem` | Renders a task as a togglable checkbox item with a link to its source so that it can update |
| `templates.itemItem` | Renders a list item with a link to its source |
| `templates.paragraphItem` | Renders a paragraph with a link to its source |
| `templates.tagItem` | Renders a tag as a linked hashtag |

# Page templates
[[Page Template|Page templates]] are pages tagged with `#meta/template/page`. They serve as blueprints for creating new pages — you can configure them with suggested names, keyboard shortcuts, and commands.

# Slash templates
[[Slash Templates]] are pages tagged with `#meta/template/slash`. They define [[Slash Command|slash commands]] that insert templated content at the cursor position. The last component of the page name becomes the slash command name.

See also: [[API/template]], [[Page Template]], [[Slash Templates]], [[Space Lua]]