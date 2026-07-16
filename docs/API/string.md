---
tags: api/lua
references:
- client/space_lua/stdlib/string.ts
- client/space_lua/stdlib/string_pack.ts
---

The `string` module contains Lua string operations and Space Lua extensions.

> **note** Note
> Since string values use `string` as their metatable, these APIs can also be called as methods. For example, `someString:startsWith("h")` is equivalent to `string.startsWith(someString, "h")`.

## Lua pattern matching

Lua patterns are not regular expressions. Space Lua translates Lua patterns to JavaScript regular expressions and has a few compatibility differences:

1. Magic characters `^$()%.[]*+-?` must be escaped to represent literal characters. Standard Lua does not require escaping a magic character when it is not contextually magic, so patterns such as `%d--` can behave differently in Space Lua.
2. Space Lua allows repetition characters (`?`, `*`, `+`, and `-`) to apply to captures; standard Lua does not.
3. The *n*th captured string (`%n`), balanced match (`%bxy`), and frontier pattern (`%f[set]`) forms from the [Lua 5.4 pattern manual](https://www.lua.org/manual/5.4/manual.html#6.4.1) may not be supported.

The `string.matchRegex` and `string.matchRegexAll` extensions use JavaScript regular expressions instead of Lua patterns.

Examples of patterns that differ:

```lua
print(string.match("1234", "(%d)+"))
-- Space Lua prints "4" because repetition applies to the capture.
-- Standard Lua returns nil.

print(string.match("*", "*"))
-- Space Lua reports an invalid regular expression.
-- Standard Lua prints "*".

print(string.match("2024-03-14", "%d+-(%d+)-%d+"))
-- Space Lua reports an invalid regular expression because the hyphens are not escaped.
-- Standard Lua prints "03".
```

${spacelua.renderApiDocumentation("string")}
