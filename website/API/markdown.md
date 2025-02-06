# Markdown API

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
