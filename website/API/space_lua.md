Space Lua specific functions that are available to all scripts, but are not part of the standard Lua language.

## space_lua.parse_expression(luaExpression)
Parses a lua expression and returns the parsed expression as an AST.

Example:

    space_lua.parse_expression("1 + 1")


## space_lua.eval_expression(parsedExpr, envAugmentation?)
Evaluates a parsed Lua expression and returns the result. Optionally accepts an environment table to augment the global environment.

Example:

${space_lua.eval_expression(space_lua.parse_expression("x + y"), {x = 1, y = 2})}

## space_lua.interpolate(template, envAugmentation?)
Interpolates a string with lua expressions and returns the result. Expressions are wrapped in ${...} syntax. Optionally accepts an environment table to augment the global environment.

${space_lua.interpolate("Hello ${name}!", {name="Pete"})}