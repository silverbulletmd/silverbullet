---
tags: api/syscall
references:
- plug-api/syscalls/markdown.ts
- client/plugos/syscalls/markdown.ts
- client/markdown_renderer/markdown_render.ts
- client/markdown_parser/parser.ts
---

The Markdown API provides functions for parsing and rendering Markdown content.

<!--#lua spacelua.renderApiDocumentation("markdown") -->
## markdown.bakeSections

`markdown.bakeSections(text, pageName?)`

Re-evaluates all baked Lua sections in Markdown text; sections that error or only render as HTML are left unchanged.

**Parameters:**

- `text` (`string`) — Markdown containing baked sections.
- `pageName?` (`string`) — Page used as currentPage during evaluation.

**Returns:**

- `string` — Markdown with updated baked section bodies.

**Example:**

```lua
local text = "Total: <!--#lua 1 + 2 -->\nold\n<!-- /lua -->"
print(markdown.bakeSections(text))
```

## markdown.expandMarkdown

`markdown.expandMarkdown(text, options?)`
`markdown.expandMarkdown(tree, options?)`

Expands Markdown transclusions, Lua directives, and task references.

**Parameters:**

- `textOrTree` — Markdown text or parsed tree.
- `options?` (`table`) — Expansion switches: expandTransclusions, expandLuaDirectives, and rewriteTasks; all default to true.

**Returns:**

- Value — Expanded text or tree, matching the input form.

**Example:**

```lua
local expanded = markdown.expandMarkdown("This is some Lua: ${1 + 2}")
```

## markdown.markdownToHtml

`markdown.markdownToHtml(text, options?)`

Renders Markdown text to HTML.

**Parameters:**

- `text` (`string`) — Markdown source.
- `options?` (`table`) — HTML rendering options.

**Returns:**

- `string` — Rendered HTML.

**Example:**

```lua
local html = markdown.markdownToHtml("# Title")
```

## markdown.objectsToTable

`markdown.objectsToTable(data, options?)`

Formats a list of objects as a Markdown table.

**Parameters:**

- `data` (`table`) — Rows to render.
- `options?` (`table`) — Optional renderCell callback.

**Returns:**

- `string` — Markdown table.

**Example:**

```lua
local tableText = markdown.objectsToTable({{name = "Pete", age = 20}})
```

## markdown.parseMarkdown

`markdown.parseMarkdown(text)`

Parses Markdown text into a syntax tree.

**Parameters:**

- `text` (`string`) — Markdown source.

**Returns:**

- `table` — Parsed Markdown tree.

**Example:**

```lua
local tree = markdown.parseMarkdown("# Title")
```

## markdown.renderParseTree

`markdown.renderParseTree(tree)`

Renders a Markdown syntax tree back to source text.

**Parameters:**

- `tree` (`table`) — Markdown syntax tree.

**Returns:**

- `string` — Rendered Markdown.

**Example:**

```lua
local tree = markdown.parseMarkdown("# Title")
print(markdown.renderParseTree(tree))
```
<!--/lua-->

