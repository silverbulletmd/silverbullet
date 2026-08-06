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

<!--#lua spacelua.renderApiDocumentation("string") -->
## string.byte

`string.byte(s, i?, j?)`

Returns the numeric character codes in the inclusive range from `i` to `j`.

**Parameters:**

- `s` (`string`)
- `i?` (`integer`)
- `j?` (`integer`)

**Returns:**

- `integer` — One result per character.

## string.char

`string.char(...): string`

Creates a string from numeric character codes.

**Returns:**

- `string`

## string.endsWith

`string.endsWith(s, suffix)`

Returns whether a string ends with a literal suffix.

**Parameters:**

- `s` (`string`)
- `suffix` (`string`)

**Returns:**

- `boolean`

## string.find

`string.find(s, pattern, init?, plain?)`

Finds the first Lua-pattern match and returns its bounds followed by captures.

**Parameters:**

- `s` (`string`)
- `pattern` (`string`)
- `init?` (`integer`)
- `plain?` (`boolean`)

**Returns:**

- `integer|nil` — Start index or `nil`.
- `integer` — End index.

## string.format

`string.format(format, ...): string`

Formats values according to a C-style format string.

**Parameters:**

- `format` (`string`)
- `...` — Values consumed by conversion specifiers.

**Returns:**

- `string`

**Example:**

```lua
print(string.format("Name: %s, score: %.1f", "Ada", 9.5))
```

## string.gmatch

`string.gmatch(s, pattern, init?)`

Returns an iterator over successive Lua-pattern matches and captures.

**Parameters:**

- `s` (`string`)
- `pattern` (`string`)
- `init?` (`integer`)

**Returns:**

- `function` — Match iterator.

**Example:**

```lua
for word in string.gmatch("hello world", "%w+") do
  print(word)
end
```

## string.gsub

`string.gsub(s, pattern, replacement, n?)`

Replaces Lua-pattern matches using a string, table, or function replacement.

**Parameters:**

- `s` (`string`)
- `pattern` (`string`)
- `replacement` (`string|table|function`)
- `n?` (`integer`)

**Returns:**

- `string` — Result string.
- `integer` — Number of replacements.

**Example:**

```lua
local result, count = string.gsub("hello hello", "hello", "hi", 1)
print(result, count) -- hi hello  1
```

## string.len

`string.len(s)`

Returns the length of a string.

**Parameters:**

- `s` (`string`)

**Returns:**

- `integer`

## string.lower

`string.lower(s)`

Returns a copy of a string converted to lowercase.

**Parameters:**

- `s` (`string`)

**Returns:**

- `string`

## string.match

`string.match(s, pattern, init?)`

Returns captures from the first Lua-pattern match, or `nil` when none is found.

**Parameters:**

- `s` (`string`)
- `pattern` (`string`)
- `init?` (`integer`)

**Returns:**

- Value — Pattern captures, whole match, or `nil`.

**Example:**

```lua
local year, month = string.match("2024-03", "(%d+)%-(%d+)")
```

## string.matchRegex

`string.matchRegex(s, pattern)`

Matches a string with a JavaScript regular expression and returns the match array.

**Parameters:**

- `s` (`string`)
- `pattern` (`string`)

**Returns:**

- `table|nil`

**Example:**

```lua
local match = string.matchRegex("hello123", "([a-z]+)([0-9]+)")
print(match[1], match[2], match[3])
```

## string.matchRegexAll

`string.matchRegexAll(s, pattern)`

Returns an iterator over all JavaScript regular-expression matches.

**Parameters:**

- `s` (`string`)
- `pattern` (`string`)

**Returns:**

- `function` — Iterator yielding match arrays.

**Example:**

```lua
for match in string.matchRegexAll("a1b2", "([a-z])([0-9])") do
  print(match[1], match[2], match[3])
end
```

## string.pack

`string.pack(format, ...): string`

Packs values into a binary string according to a Lua 5.4 format string.

**Parameters:**

- `format` (`string`) — Binary packing format.
- `...` — Values consumed by the format options.

**Returns:**

- `string` — Packed binary string.

## string.packsize

`string.packsize(format)`

Returns the byte size of a fixed-length Lua 5.4 packing format.

**Parameters:**

- `format` (`string`) — Fixed-length binary packing format.

**Returns:**

- `integer` — Packed byte count.

## string.rep

`string.rep(s, n, sep?)`

Returns `n` copies of a string joined by an optional separator.

**Parameters:**

- `s` (`string`)
- `n` (`integer`)
- `sep?` (`string`)

**Returns:**

- `string`

## string.reverse

`string.reverse(s)`

Returns a string with its characters in reverse order.

**Parameters:**

- `s` (`string`)

**Returns:**

- `string`

## string.split

`string.split(s, sep)`

Splits a string on a literal separator and returns the substrings.

**Parameters:**

- `s` (`string`)
- `sep` (`string`)

**Returns:**

- `table`

**Example:**

```lua
for part in each(string.split("a,b,c", ",")) do
  print(part)
end
```

## string.startsWith

`string.startsWith(s, prefix)`

Returns whether a string starts with a literal prefix.

**Parameters:**

- `s` (`string`)
- `prefix` (`string`)

**Returns:**

- `boolean`

## string.sub

`string.sub(s, i, j?)`

Returns the substring from inclusive index `i` through `j`, supporting negative indices.

**Parameters:**

- `s` (`string`)
- `i` (`integer`)
- `j?` (`integer`)

**Returns:**

- `string`

## string.trim

`string.trim(s)`

Removes whitespace from both ends of a string.

**Parameters:**

- `s` (`string`)

**Returns:**

- `string`

## string.trimEnd

`string.trimEnd(s)`

Removes whitespace from the end of a string.

**Parameters:**

- `s` (`string`)

**Returns:**

- `string`

## string.trimStart

`string.trimStart(s)`

Removes whitespace from the beginning of a string.

**Parameters:**

- `s` (`string`)

**Returns:**

- `string`

## string.unpack

`string.unpack(format, data, init?)`

Unpacks values from a binary string according to a Lua 5.4 format string.

**Parameters:**

- `format` (`string`) — Binary unpacking format.
- `data` (`string`) — Packed binary string.
- `init?` (`integer`) — One-based starting position.

**Returns:**

- Value — Unpacked values followed by the next unread position.

## string.upper

`string.upper(s)`

Returns a copy of a string converted to uppercase.

**Parameters:**

- `s` (`string`)

**Returns:**

- `string`
<!--/lua-->

