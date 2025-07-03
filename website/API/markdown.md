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
```

### markdown.markdownToHtml(text)
Renders a piece of markdown text into HTML

Example:
```lua
local text = "# Title\n\nSome text"
local html = markdown.markdownToHtml(text)
print("Rendered html:", html)
```

### markdown.expandMarkdown(tree)
Expands custom markdown Lua directives and transclusions into plain markdown inside a ParseTree

Example:
```lua
local text = "This is a some lua ${os.time()}"
local tree = markdown.parseMarkdown(text)
local expandedTree = markdown.expandMarkdown(tree)
local rendered = markdown.renderParseTree(expandedTree)
print("Rendered markdown:", rendered)
```