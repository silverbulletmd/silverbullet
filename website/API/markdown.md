# Markdown API

The Markdown API provides functions for parsing and rendering Markdown content.

## Markdown Operations

### markdown.parse_markdown(text)
Parses a piece of markdown text into a ParseTree.

Example:
```lua
local text = [[
# Hello World

This is a **bold** statement.
]]

local tree = markdown.parse_markdown(text)
print("Parsed markdown tree:", tree)
```

### markdown.render_parse_tree(tree)
Renders a ParseTree back to markdown text.

Example:
```lua
local text = "# Title\n\nSome text"
local tree = markdown.parse_markdown(text)
-- Modify tree if needed
local rendered = markdown.render_parse_tree(tree)
print("Rendered markdown:", rendered)
``` 