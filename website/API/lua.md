The Lua API provides functions for parsing and evaluating Lua code.

### lua.parse(code)
Parses a string of Lua code into an abstract syntax tree (AST).

Parameters:
- `code`: The Lua code to parse

Returns a LuaBlock object representing the parsed code.

Example:
```lua
local ast = lua.parse("print('Hello')")
-- ast contains the parsed syntax tree
```

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