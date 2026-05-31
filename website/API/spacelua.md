#api/space-lua

The Space Lua API provides functions for working with Lua expressions and templates.

## spacelua.parseExpression(luaExpression)
Parses a lua expression and returns the parsed expression as an AST.

Example:
```lua
local parsedExpression = spacelua.parseExpression("1 + 1")
```

## spacelua.parseBlock(code)
Parses a Lua chunk (a block of statements) and returns the parsed block as an AST.

Example:
```lua
local parsedBlock = spacelua.parseBlock("local x = 1\nreturn x + 2")
```

## spacelua.prettyPrintExpression(parsedExpr, options?)
Pretty-prints a parsed Lua expression AST back to formatted Lua source.

The optional `options` table accepts:
* `indentWidth` (number, default `2`): number of spaces per indentation level.
* `quote` (`"double"` or `"single"`, default `"double"`): quote style for strings.
* `trailingComma` (boolean, default `true`): whether multi-line tables get a trailing comma.

> **note** Comments
> The parser does not retain comments, so pretty-printing a parsed AST does not preserve any comments from the original source.

Example:
```lua
local parsedExpr = spacelua.parseExpression("{a=1,b=2}")
print(spacelua.prettyPrintExpression(parsedExpr))
-- prints:
-- {
--   a = 1,
--   b = 2,
-- }
```

## spacelua.prettyPrintBlock(parsedBlock, options?)
Pretty-prints a parsed Lua block AST back to formatted Lua source. Accepts the same `options` table as [[#spacelua.prettyPrintExpression(parsedExpr, options?)]].

Reformatting a chunk of Lua source is a parse followed by a pretty-print:
```lua
local formatted = spacelua.prettyPrintBlock(spacelua.parseBlock("if a then return 1 end"))
print(formatted)
-- prints:
-- if a then
--   return 1
-- end
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
