Space Lua includes a comprehensive standard library based on Lua 5.4, with additional non-standard extensions useful for text processing and note-taking workflows.

This page gives an overview. Each module has its own detailed API reference page.

# Global functions
The following functions are available globally (no module prefix needed):

| Function | Description |
|---|---|
| `print(...)` | Print to the log (browser console or server log) |
| `type(v)` | Returns the type of a value as a string |
| `tostring(v)` | Converts a value to its string representation |
| `tonumber(s)` | Converts a string to a number |
| `assert(expr, msg?)` | Raises an error if `expr` is falsy |
| `error(msg)` | Throws an error |
| `pcall(fn, ...)` | Calls a function in protected mode, catching errors |
| `xpcall(fn, handler)` | Like `pcall` but with a custom error handler |
| `pairs(t)` | Iterator over all key-value pairs in a table |
| `ipairs(t)` | Iterator over integer-keyed entries in order |
| `unpack(t)` | Unpacks a table into individual values |
| `setmetatable(t, mt)` | Sets the metatable for a table |
| `getmetatable(t)` | Gets the metatable of a table |
| `rawset(t, k, v)` | Sets a table key bypassing metamethods |
| `dofile(path)` | Loads and executes a `.lua` file from your space |

**Non-standard globals:**

| Function | Description |
|---|---|
| `each(t)` | Iterator over values only (no indices) |
| `some(v)` | Returns `nil` if value is "empty" (empty table, whitespace-only string, inf, nan), otherwise returns the value unchanged |

`some()` is particularly useful in templates and queries for handling missing data gracefully:

```lua
print(some("hello"))       -- hello
print(some(""))            -- nil
print(some({}))            -- nil
print(some({}) or "empty") -- empty
```

Full reference: [[API/global]]

# string
Standard Lua string operations plus useful extensions. Since strings have `string` as their metatable, you can call these as methods: `s:startsWith("h")`.

**Non-standard extensions:**

| Function | Description |
|---|---|
| `string.split(s, sep)` | Splits a string by separator |
| `string.startsWith(s, prefix)` | Tests if a string starts with a prefix |
| `string.endsWith(s, suffix)` | Tests if a string ends with a suffix |
| `string.trim(s)` | Strips whitespace from both ends |
| `string.trimStart(s)` | Strips leading whitespace |
| `string.trimEnd(s)` | Strips trailing whitespace |
| `string.matchRegex(s, pattern)` | Matches against a JavaScript regex |
| `string.matchRegexAll(s, pattern)` | Iterator over all JavaScript regex matches |

> **warning** Lua patterns vs. regex
> Standard Lua `string.find`, `string.match`, `string.gmatch`, and `string.gsub` use Lua patterns, which are _not_ regular expressions. See [[API/string]] for differences. Use `matchRegex`/`matchRegexAll` when you need full regex support.

Full reference: [[API/string]]

# table
Table manipulation functions, plus non-standard extensions:

| Function | Description |
|---|---|
| `table.keys(t)` | Returns an array of all keys |
| `table.includes(t, value)` | Checks if a list contains a value |
| `table.find(t, fn, from?)` | Finds first element matching a criteria function |
| `table.select(t, keys...)` | Returns a new table with only selected keys |

Full reference: [[API/table]]

# math
Standard Lua math functions (`abs`, `ceil`, `floor`, `max`, `min`, `sqrt`, `sin`, `cos`, trigonometric functions, etc.) plus:

| Function | Description |
|---|---|
| `math.cosineSimilarity(a, b)` | Cosine similarity between two vectors |

Full reference: [[API/math]]

# os
Date and time functions:

| Function | Description |
|---|---|
| `os.time(table?)` | Current Unix timestamp, or timestamp for a specific date |
| `os.date(format?, timestamp?)` | Formats a timestamp as a string |

Full reference: [[API/os]]

# encoding
Functions for encoding and decoding data:

| Function | Description |
|---|---|
| `encoding.base64Encode(data)` | Encode data as base64 |
| `encoding.base64Decode(s)` | Decode a base64 string |
| `encoding.utf8Encode(s)` | Encode a UTF-8 string to bytes |
| `encoding.utf8Decode(data)` | Decode bytes to a UTF-8 string |

Full reference: [[API/encoding]]

See also: [[Space Lua]], [[Space Lua/JavaScript Interop]]
