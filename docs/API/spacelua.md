---
tags: api/space-lua
references:
- client/space_lua.ts
- client/space_lua_api.ts
- client/space_lua/runtime.ts
---

The Space Lua API provides functions for working with Lua expressions and templates.

<!--#lua spacelua.renderApiDocumentation("spacelua") -->
## spacelua.baseUrl

`spacelua.baseUrl()`

Returns the SilverBullet instance's base URL, or `nil` when run on the server.

**Returns:**

- `string|nil`

**Example:**

```lua
local url = spacelua.baseUrl()
print(url)
```

## spacelua.describe

`spacelua.describe(functionOrName)`

Returns structured documentation for a Lua function value or dotted API name.

**Parameters:**

- `functionOrName` (`function|string`) — Function value or dotted API name to inspect.

**Returns:**

- `table|nil` — Structured function metadata, or `nil` when the target is not a function.

**Example:**

```lua
local info = spacelua.describe(editor.getText)
print(info.name, info.kind, info.see)

local sameInfo = spacelua.describe("editor.getText")
```

## spacelua.evalExpression

`spacelua.evalExpression(parsedExpr, envAugmentation?)`

Evaluates a parsed Lua expression, optionally with additional environment values.

**Parameters:**

- `parsedExpr` (`table`) — Parsed expression AST.
- `envAugmentation?` (`table`) — Values added to the expression environment.

**Returns:**

- Value — Evaluated result.

**Example:**

```lua
local parsed = spacelua.parseExpression("x + y")
local result = spacelua.evalExpression(parsed, {x = 1, y = 2})
print(result)
```

## spacelua.interpolate

`spacelua.interpolate(template, envAugmentation?)`

Interpolates `${...}` Lua expressions in a string, optionally with additional environment values.

**Parameters:**

- `template` (`string`) — Template containing `${...}` expressions.
- `envAugmentation?` (`table`) — Values added to the interpolation environment.

**Returns:**

- `string` — Interpolated string.

**Example:**

```lua
local greeting = spacelua.interpolate("Hello ${name}!", {name = "Pete"})
print(greeting)
```

## spacelua.listFunctions

`spacelua.listFunctions(namespace?)`

Lists documented functions in the global environment or an API namespace.

**Parameters:**

- `namespace?` (`table|string`) — Namespace table or dotted name; omit for globals.

**Returns:**

- `table` — Function metadata records.

**Example:**

```lua
for info in each(spacelua.listFunctions("editor")) do
  print(info.name, info.description or info.see)
end
```

## spacelua.parseBlock

`spacelua.parseBlock(code)`

Parses a Lua chunk and returns its AST. Blocks retain comments in source order with their exact text, kind, and source range.

**Parameters:**

- `code` (`string`) — Lua code to parse.

**Returns:**

- `table` — Parsed block AST.

**Example:**

```lua
local parsed = spacelua.parseBlock("local x = 1\nreturn x + 2")
```

## spacelua.parseExpression

`spacelua.parseExpression(luaExpression)`

Parses a Lua expression and returns its AST.

**Parameters:**

- `luaExpression` (`string`) — Lua expression to parse.

**Returns:**

- `table` — Parsed expression AST.

**Example:**

```lua
local parsed = spacelua.parseExpression("1 + 1")
```

## spacelua.prettyPrintBlock

`spacelua.prettyPrintBlock(block, options?)`

Pretty-prints a parsed Lua block AST. Comments are preserved while their placement and indentation are normalized.

**Parameters:**

- `block` (`table`) — Parsed block AST.
- `options?` (`table`) — Formatting options: `indentWidth`, `quote`, and `trailingComma`.

**Returns:**

- `string` — Formatted Lua source.

**Example:**

```lua
local formatted = spacelua.prettyPrintBlock(spacelua.parseBlock("if a then return 1 end"))
print(formatted)
```

## spacelua.prettyPrintExpression

`spacelua.prettyPrintExpression(parsedExpr, options?)`

Pretty-prints a parsed Lua expression AST.

**Parameters:**

- `parsedExpr` (`table`) — Parsed expression AST.
- `options?` (`table`) — Formatting options: `indentWidth`, `quote`, and `trailingComma`.

**Returns:**

- `string` — Formatted Lua source.

**Example:**

```lua
local parsed = spacelua.parseExpression("{a=1,b=2}")
print(spacelua.prettyPrintExpression(parsed))
```

## spacelua.renderApiDocumentation

`spacelua.renderApiDocumentation(target?)`

Renders API documentation for a function, namespace, or the global environment as Markdown.

**Parameters:**

- `target?` (`function|table|string`) — Function value, namespace table, or dotted API name to document; omit for globals.

**Returns:**

- `string` — Rendered Markdown.

**Examples:**

Render a namespace as a live API-page directive.

```markdown
${spacelua.renderApiDocumentation("lua")}
```

Render one function by its dotted API name.

```markdown
${spacelua.renderApiDocumentation("editor.getText")}
```
<!--/lua-->

