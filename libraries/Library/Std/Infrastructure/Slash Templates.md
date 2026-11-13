---
description: Implements the infrastructure of Slash Templates.
---
Allows for quick definition of slash commands based on templates.

# Creating slash templates

Create a page with the `#meta/template/slash` tag. The last component of the page name (after the `/` if any) will be
used as the slash command’s name. The body of the page will be used as the text to be inserted, using Lua directives is
supported.

## Configuration

You can configure some specifics about your slash template in its template page’s frontmatter.

Optional keys:

* `displayName`: The label shown in the menu instead of the name (which still finds it when typed)
* `description`: The description of the slash command
* `icon`: A Feather icon name, an `md-*` editor icon or inline `<svg>` markup
* `aliases`: More words that find the slash command when typed after `/`
* `group`: The menu section it's listed under, e.g. `Basic blocks`
* `priority`: To prioritize the slash command higher in its group
* `block`: `insert` to insert it as a block of its own (after the current line when that has text), or `convert` to turn the current line into it (the line's text goes where `|^|` is)
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
      displayName = schema.string(),
      description = schema.string(),
      icon = schema.string(),
      aliases = schema.array("string"),
      group = schema.string(),
      priority = schema.number(),
      block = { type = "string", enum = {"insert", "convert"} },
      onlyContexts = schema.array("string"),
      exceptContexts = schema.array("string"),
    },
  }
}

-- Again on index:ready: on a fresh client the index is still empty at load
local function defineSlashTemplates()
  for st in query[[
      from index.pages("meta/template/slash")
    ]] do
    local components = st.name:split("/")
    local name = components[#components]
    slashCommand.define {
      name = name,
      displayName = st.displayName,
      description = st.description,
      icon = st.icon,
      aliases = st.aliases,
      group = st.group,
      priority = st.priority,
      onlyContexts = st.onlyContexts,
      exceptContexts = st.exceptContexts,
      run = function()
        local tpl = template.fromPage(st.name, st.raw)
        if st.block == "insert" then
          slashCommand.insertBlock(tpl())
        elseif st.block == "convert" then
          slashCommand.convertLine(tpl())
        else
          editor.insertAtCursor(tpl(), false, true)
        end
      end
    }
  end
end

defineSlashTemplates()
event.listen {
  name = "index:ready",
  run = defineSlashTemplates
}
```
