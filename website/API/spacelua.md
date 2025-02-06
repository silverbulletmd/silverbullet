The Space Lua API provides functions for working with Lua expressions and templates.

## spacelua.parseExpression(luaExpression)
Parses a lua expression and returns the parsed expression as an AST.

Example:
```lua
local parsedExpression = spacelua.parseExpression("1 + 1")
```

## spacelua.evalExpression(parsedExpr, envAugmentation?)
Evaluates a parsed Lua expression and returns the result. Optionally accepts an environment table to augment the global environment.

Example:
${spacelua.evalExpression(spacelua.parseExpression("x + y"), {x = 1, y = 2})}

## spacelua.interpolate(template, envAugmentation?)
Interpolates a string with lua expressions and returns the result. Expressions are wrapped in ${...} syntax. Optionally accepts an environment table to augment the global environment.

Example:
${spacelua.interpolate("Hello ${name}!", {name="Pete"})}
