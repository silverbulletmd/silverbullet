---
tags: api/syscall
references:
- plug-api/syscalls/lua.ts
- client/space_lua/syscalls.ts
- client/space_lua_api.ts
---

The Lua API provides functions for parsing and evaluating Lua code.

<!--#lua spacelua.renderApiDocumentation("lua") -->
## lua.evalExpression

`lua.evalExpression(expression)`

Evaluates a Space Lua expression.

**Parameters:**

- `expression` (`string`) — Lua expression to evaluate.

**Returns:**

- Value — Evaluated result.

**Example:**

```lua
local result = lua.evalExpression("1 + 2 * 3")
print(result)
```

## lua.inspect

`lua.inspect(path?)`

Inspects a value in the live Space Lua environment and returns serializable type, function, definition, and property metadata.

**Parameters:**

- `path?` (`table`) — Sequence of property names from the global environment; omit to inspect globals.

**Returns:**

- `table|nil` — Inspection metadata, or nil when the requested path does not exist.

**Example:**

```lua
local info = lua.inspect({"editor", "getText"})
```

## lua.parse

`lua.parse(code)`

> **Deprecated:** Use lua.parseBlock instead.

Deprecated alias for lua.parseBlock.

**Parameters:**

- `code` (`string`) — Lua code to parse.

**Returns:**

- `table` — Parsed Lua block AST.

## lua.parseBlock

`lua.parseBlock(code)`

Parses a Space Lua chunk and returns its AST. Blocks retain comments in source order with their exact text, kind, and source range.

**Parameters:**

- `code` (`string`) — Lua code to parse.

**Returns:**

- `table` — Parsed Lua block AST.

**Example:**

```lua
local ast = lua.parseBlock("print(\"Hello\")")
```

## lua.parseExpression

`lua.parseExpression(expression)`

Parses a Space Lua expression and returns its AST.

**Parameters:**

- `expression` (`string`) — Lua expression to parse.

**Returns:**

- `table` — Parsed expression AST.

**Example:**

```lua
local expression = lua.parseExpression("1 + 2 * 3")
```

## lua.prettyPrintBlock

`lua.prettyPrintBlock(block, options?)`

Pretty-prints a parsed Space Lua block. Comments are preserved while their placement and indentation are normalized.

**Parameters:**

- `block` (`table`) — Parsed block AST.
- `options?` (`table`) — Formatting options: `indentWidth`, `quote`, and `trailingComma`.

**Returns:**

- `string` — Formatted Lua source.

**Example:**

```lua
local formatted = lua.prettyPrintBlock(lua.parseBlock("if a then return 1 end"))
```

## lua.prettyPrintExpression

`lua.prettyPrintExpression(expression, options?)`

Pretty-prints a parsed Space Lua expression.

**Parameters:**

- `expression` (`table`) — Parsed expression AST.
- `options?` (`table`) — Formatting options: `indentWidth`, `quote`, and `trailingComma`.

**Returns:**

- `string` — Formatted Lua source.

**Example:**

```lua
local formatted = lua.prettyPrintExpression(lua.parseExpression("{a=1,b=2}"))
```
<!--/lua-->

