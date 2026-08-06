---
tags: api/lua
references:
- client/space_lua/stdlib.ts
- client/space_lua/runtime.ts
---

These functions are defined in the global namespace. Alongside standard Lua functions, Space Lua provides the `each` and `some` convenience functions.

<!--#lua spacelua.renderApiDocumentation() -->
## adder

`adder(a, b)`

Adds two numbers.

**Parameters:**

- `a` (`number`) — First number.
- `b` (`number`) — Second number.

**Returns:**

- `number` — sum

## assert

`assert(value, message?)`

Raises an error when a value is falsy; otherwise completes successfully.

**Parameters:**

- `value` — Condition to test.
- `message?` (`string`) — Error detail.

**Example:**

```lua
assert(user ~= nil, "user is required")
```

**See:** [[API/global]]

## clock

`clock()`

## dofile

`dofile(path)`

Reads and executes a Lua source file from the current space.

**Parameters:**

- `path` (`string`) — Space-relative Lua file path.

**See:** [[API/global]]

## each

`each(table)`

Returns a Space Lua iterator over array-like values without yielding indices.

**Parameters:**

- `table` (`table`)

**Returns:**

- `function` — Iterator yielding values.

**Example:**

```lua
for fruit in each({"apple", "banana"}) do
  print(fruit)
end
```

**See:** [[API/global]]

## error

`error(message)`

Raises a Lua runtime error with the supplied message.

**Parameters:**

- `message` (`string`)

**See:** [[API/global]]

## formatMarkdownTable

`formatMarkdownTable(tree)`

**Parameters:**

- `tree`

## getmetatable

`getmetatable(table)`

Returns a table's metatable, or `nil` when none is set.

**Parameters:**

- `table` (`table`)

**Returns:**

- `table|nil`

**See:** [[API/global]]

## helloWorld

`helloWorld(name)`

**Parameters:**

- `name`

## ipairs

`ipairs(table)`

Returns an iterator over consecutive integer keys starting at 1 and stopping at the first `nil`.

**Parameters:**

- `table` (`table`)

**Returns:**

- `function` — Iterator yielding index and value.

**Example:**

```lua
for i, fruit in ipairs({"apple", "banana"}) do
  print(i, fruit)
end
```

**See:** [[API/global]]

## load

`load(chunk)`

Compiles Lua source into a callable chunk without executing it.

**Parameters:**

- `chunk` (`string`) — Lua source code.

**Returns:**

- `function|nil` — Compiled chunk or `nil`.
- `string` — Compilation error when unsuccessful.

**See:** [[API/global]]

## marquee

`marquee(text)`

**Parameters:**

- `text`

## next

`next(table, index?)`

Returns the next table key and value after a given key, or the first pair when the key is omitted.

**Parameters:**

- `table` (`table`)
- `index?` — Previous key.

**Returns:**

- Value — Next key or `nil`.
- Value — Value at the next key.

**See:** [[API/global]]

## nodeParentOfType

`nodeParentOfType(tree, position, nodeType)`

**Parameters:**

- `tree`
- `position`
- `nodeType`

## pairs

`pairs(table)`

Returns an iterator over all table key-value pairs, respecting `__pairs`.

**Parameters:**

- `table` (`table`)

**Returns:**

- `function` — Iterator plus its state and initial control value.

**Example:**

```lua
for key, value in pairs({name = "Ada", age = 36}) do
  print(key, value)
end
```

**See:** [[API/global]]

## pcall

`pcall(function, ...): boolean, ...`

Calls a function in protected mode and returns a success flag followed by results or an error message.

**Parameters:**

- `function` (`function`)
- `...` — Arguments passed to the function.

**Returns:**

- `boolean` — Whether the call succeeded.
- Value — Call results or error message.

**Example:**

```lua
local ok, result = pcall(function() return mightFail() end)
```

**See:** [[API/global]]

## print

`print(...)`

Prints string representations of its arguments to the runtime log.

**Parameters:**

- `...` — Values to print.

**Example:**

```lua
print("Hello, world!")
```

**See:** [[API/global]]

## rawequal

`rawequal(a, b)`

Tests two values for equality without invoking `__eq`.

**Parameters:**

- `a`
- `b`

**Returns:**

- `boolean`

**See:** [[API/global]]

## rawget

`rawget(table, key)`

Reads a table key without invoking `__index`.

**Parameters:**

- `table` (`table`)
- `key`

**Returns:**

- Value — Stored value or `nil`.

**See:** [[API/global]]

## rawlen

`rawlen(value)`

Returns a string or table length without invoking `__len`.

**Parameters:**

- `value` (`string|table`)

**Returns:**

- `integer`

**See:** [[API/global]]

## rawset

`rawset(table, key, value)`

Sets a table key without invoking `__newindex` and returns the table.

**Parameters:**

- `table` (`table`)
- `key`
- `value`

**Returns:**

- `table`

**Example:**

```lua
local t = setmetatable({}, {__newindex = function() error("blocked") end})
rawset(t, "name", "Ada")
```

**See:** [[API/global]]

## select

`select("#", ...): integer`
`select(index, ...): ...`

Returns the count of extra arguments or all arguments from a selected position onward.

**Parameters:**

- `index` (`integer|string`) — One-based index, negative index from the end, or `#`.
- `...`

**Returns:**

- Value — Argument count or selected argument values.

**See:** [[API/global]]

## setmetatable

`setmetatable(table, metatable)`

Sets a table's metatable and returns the table.

**Parameters:**

- `table` (`table`)
- `metatable` (`table`)

**Returns:**

- `table`

**See:** [[API/global]]

## some

`some(value)`

Returns `nil` for empty Space Lua values and otherwise returns the value unchanged.

**Parameters:**

- `value` — Value to normalize; blank strings, empty tables, infinities, and NaN are empty.

**Returns:**

- Value — Original value or `nil`.

**Example:**

```lua
print(some("  ") or "empty")
print(some({}) or "empty")
print(some(0))
```

**See:** [[API/global]]

## toggleReadOnlyMode

`toggleReadOnlyMode()`

## tonumber

`tonumber(value): number|nil`
`tonumber(value, base): integer|nil`

Converts a number or numeric string to a Lua number, optionally in a base from 2 through 36.

**Parameters:**

- `value` (`number|string`)
- `base?` (`integer`)

**Returns:**

- `number|nil`

**Example:**

```lua
print(tonumber("2a", 16)) -- 42
```

**See:** [[API/global]]

## tostring

`tostring(value)`

Converts a value to a string, respecting its `__tostring` metamethod.

**Parameters:**

- `value`

**Returns:**

- `string`

**See:** [[API/global]]

## type

`type(value)`

Returns the Lua type name of a value.

**Parameters:**

- `value`

**Returns:**

- `string`

**See:** [[API/global]]

## xpcall

`xpcall(function, errorHandler, ...): boolean, ...`

Calls a function in protected mode and transforms any error with an error handler.

**Parameters:**

- `function` (`function`)
- `errorHandler` (`function`)
- `...` — Arguments passed to the function.

**Returns:**

- `boolean` — Whether the call succeeded.
- Value — Call results or handler results.

**Example:**

```lua
local ok, message = xpcall(riskyOperation, function(err)
  return "Operation failed: " .. tostring(err)
end)
```

**See:** [[API/global]]
<!--/lua-->

