---
description: Implements the infrastructure of Slash Templates.
tags: meta
---
Allows for quick definition of slash commands based on templates.

# Creating slash templates

Create a page with the `#meta/template/slash` tag. The last component of the page name (after the `/` if any) will be
used as the slash command’s name. The body of the page will be used as the text to be inserted, using Lua directives is
supported.

## Configuration

You can configure some specifics about your slash template in its template page’s frontmatter.

Optional keys:

* `description`: The description of the slash command
* `priority`: To prioritize the slash command higher in the list
* `onlyContexts` (advanced): To only make the slash command appear in certain (AST node based) contexts
* `exceptContexts` (advanced): To make the slash command appear everywhere _except_ in these (AST node) contexts

# Currently active slash templates

${query[[
  from p = index.pages("meta/template/slash")
  select templates.fullPageItem(p)
]]}

# Implementation

```space-lua
-- priority: 10
tag.define {
  name = "meta/template/slash",
  schema = {
    type = "object",
    properties = {
      tags = {
        anyOf = {
          { type = "array", items = schema.string() },
          schema.string(),
        },
      },
      description = schema.string(),
      priority = schema.number(),
      onlyContexts = schema.array("string"),
      exceptContexts = schema.array("string"),
    },
  }
}

for st in query[[
    from index.pages("meta/template/slash")
  ]] do
  local components = st.name:split("/")
  local name = components[#components]
  slashCommand.define {
    name = name,
    description = st.description,
    priority = st.priority,
    onlyContexts = st.onlyContexts,
    exceptContexts = st.exceptContexts,
    run = function()
      local tpl = template.fromPage(st.name, st.raw)
      editor.insertAtCursor(tpl(), false, true)
    end
  }
end
```
