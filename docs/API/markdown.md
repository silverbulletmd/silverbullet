#api/syscall

The Markdown API provides functions for parsing and rendering Markdown content.

## Markdown Operations
### markdown.parseMarkdown(text)
Parses a piece of markdown text into a ParseTree.

Example:
```lua
local text = [[
# Hello World

This is a **bold** statement.
]]

local tree = markdown.parseMarkdown(text)
print("Parsed markdown tree:", tree)
```

### markdown.renderParseTree(tree)
Renders a ParseTree back to markdown text.

Example:
```lua
local text = "# Title\n\nSome text"
local tree = markdown.parseMarkdown(text)
-- Modify tree if needed
local rendered = markdown.renderParseTree(tree)
print("Rendered markdown:", rendered)
```

### markdown.markdownToHtml(text)
Renders a piece of markdown text into HTML

Example:
```lua
local text = "# Title\n\nSome text"
local html = markdown.markdownToHtml(text)
print("Rendered html:", html)
```

### markdown.expandMarkdown(textOrTree, options?)
Expands custom markdown Lua directives and transclusions into plain markdown. Accepts either a markdown ParseTree or string.

Options (all default to `true`):
* `expandTransclusions`: Replace (markdown transclusions) with their content
* `expandLuaDirectives`: Replace Lua directives with their evaluated values
* `rewriteTasks`: Rewrite tasks to include references so that they can be updated

Example:
```lua
local text = "This is a some lua ${os.time()}"
print("Expanded markdown:", markdown.expandMarkdown(text))
```

### markdown.objectsToTable(data, options?)
Transforms a list of tables into a markdown table.

Supported options:
* `renderCell(val, key)` custom cell renderer

Example:
${markdown.objectsToTable({{name="Pete", age=20}, {name="Jane", age=32}}, {
  renderCell=function(v, k)
  if k == "age" and v > 20 then
    return "*" .. v .. "*"
  else
    return v
  end
end})}

