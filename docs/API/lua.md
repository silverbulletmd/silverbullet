---
tags: api/syscall
references:
- plug-api/syscalls/lua.ts
- client/plugos/syscalls/lua.ts
- client/space_lua_api.ts
---

The Lua API provides functions for parsing and evaluating Lua code.

### lua.parseBlock(code)
Parses a string of Lua code (a block of statements) into an abstract syntax tree (AST).

Parameters:
- `code`: The Lua code to parse

Returns a LuaBlock object representing the parsed code.

Example:
```lua
local ast = lua.parseBlock("print('Hello')")
-- ast contains the parsed syntax tree
```

> **note** Note
> `lua.parse` is a deprecated alias for `lua.parseBlock` and is kept for backwards compatibility.

### lua.parseExpression(expression)
Parses a Lua expression into an abstract syntax tree (AST).

Parameters:
- `expression`: The Lua expression to parse

Returns a LuaExpression object representing the parsed expression.

Example:
```lua
local expr = lua.parseExpression("1 + 2 * 3")
-- expr contains the parsed expression tree
```

### lua.evalExpression(expression)
Evaluates a Lua expression and returns its result.

Parameters:
- `expression`: The Lua expression to evaluate

Returns the result of evaluating the expression.

Example:
```lua
local result = lua.evalExpression("1 + 2 * 3")
print(result)  -- prints: 7
```

### lua.prettyPrintBlock(block, options?)
Pretty-prints a parsed Lua block AST (as returned by [[#lua.parseBlock(code)]]) back to formatted Lua source.

The optional `options` table accepts `indentWidth` (number, default `2`), `quote` (`"double"` or `"single"`, default `"double"`), and `trailingComma` (boolean, default `true`). Comments are not preserved.

Example:
```lua
local formatted = lua.prettyPrintBlock(lua.parseBlock("if a then return 1 end"))
```

### lua.prettyPrintExpression(expression, options?)
Pretty-prints a parsed Lua expression AST (as returned by [[#lua.parseExpression(expression)]]) back to formatted Lua source. Accepts the same `options` table as [[#lua.prettyPrintBlock(block, options?)]].

Example:
```lua
local formatted = lua.prettyPrintExpression(lua.parseExpression("{a=1,b=2}"))
```