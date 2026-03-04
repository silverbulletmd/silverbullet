---
description: Templates invoked via slash commands to insert pre-defined content.
tags: glossary
---
Slash templates are a quick way to define [[Slash Command|slash commands]] that insert templated content at the cursor position. They are defined as pages tagged with `#meta/template/slash`.

# Creating a slash template
1. Create a new page. The last component of the page name (after the `/` if any) will be used as the slash command's name. For example, a page named `Library/Slash Template/action-items` creates a `/action-items` slash command.
2. Tag the page with `#meta/template/slash` in its [[Frontmatter]].
3. Write the template content in the page body. Lua directives (`${...}`) are supported and will be evaluated when the template is inserted.

## Example
A page named `Library/Slash Template/action-items` with this content:

~~~
---
tags: meta/template/slash
description: Insert a standard action items section
---
# Action items
* [ ] |^|
~~~

Creates a `/action-items` slash command that inserts an action items section.

# Configuration
You can configure these optional [[Frontmatter]] keys:

* `description`: The description shown in the slash command completion menu
* `priority`: Higher priority commands appear earlier in the list
* `onlyContexts` (advanced): Only show the command in certain AST node contexts
* `exceptContexts` (advanced): Show the command everywhere _except_ in these AST node contexts

# Currently active slash templates
${template.each(query[[
  from index.tag "meta/template/slash"
  where _.tag == "page"
]], templates.fullPageItem)}

See also: [[Slash Command]], [[Template]], [[Page Template]]
