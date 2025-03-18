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
```lua
local parsedExpr = spacelua.parseExpression("x + y")
local result = spacelua.evalExpression(parsedExpr, {x = 1, y = 2})
print(result)  -- prints: 3
```

## spacelua.interpolate(template, envAugmentation?)
Interpolates a string with lua expressions and returns the result. Expressions are wrapped in ${...} syntax. Optionally accepts an environment table to augment the global environment.

Example:
```lua
local greeting = spacelua.interpolate("Hello ${name}!", {name="Pete"})
print(greeting)  -- prints: Hello Pete!
```

## spacelua.baseUrl()
Returns your SilverBullet instance's base URL, or `nil` when run on the server.

Example:
```lua
local url = spacelua.baseUrl()
print(url)  -- prints something like: https://example.com
```
