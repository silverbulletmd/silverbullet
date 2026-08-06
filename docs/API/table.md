---
tags: api/lua
references:
- client/space_lua/stdlib/table.ts
---

The `table` namespace contains the Lua table library and Space Lua collection helpers.

<!--#lua spacelua.renderApiDocumentation("table") -->
## table.concat

`table.concat(table, sep?, i?, j?)`

Concatenates table elements from `i` through `j` using an optional separator.

**Parameters:**

- `table` (`table`)
- `sep?` (`string`)
- `i?` (`integer`)
- `j?` (`integer`)

**Returns:**

- `string`

## table.find

`table.find(table, criteriaFn, fromIndex?)`

Finds the first array element accepted by a predicate and returns its index and value.

**Parameters:**

- `table` (`table`)
- `criteriaFn` (`function`) — Predicate called with each value.
- `fromIndex?` (`integer`)

**Returns:**

- `integer|nil` — Matching index or `nil`.
- Value — Matching value.

**Example:**

```lua
local index, value = table.find({1, 2, 3, 4}, function(n) return n % 2 == 0 end)
```

## table.includes

`table.includes(table, value)`

Returns whether any table value is Lua-equal to a requested value.

**Parameters:**

- `table` (`table`)
- `value` — Value to find.

**Returns:**

- `boolean`

## table.insert

`table.insert(table, value)`
`table.insert(table, pos, value)`

Inserts a value at a position, shifting later elements, or appends it when no position is supplied.

**Parameters:**

- `table` (`table`)
- `posOrValue` — Insertion position or appended value.
- `value?` — Value for positional insertion.

**Example:**

```lua
local fruits = {"apple", "orange"}
table.insert(fruits, 2, "banana")
print(table.concat(fruits, ", "))
```

## table.keys

`table.keys(table)`

Returns an array containing all keys of a table or JavaScript object.

**Parameters:**

- `table` (`table`)

**Returns:**

- `table` — Array of keys.

## table.move

`table.move(a1, f, e, t, a2?)`

Moves an inclusive element range to a destination table while handling overlaps.

**Parameters:**

- `a1` (`table`) — Source table.
- `f` (`integer`) — First source index.
- `e` (`integer`) — Last source index.
- `t` (`integer`) — Destination start index.
- `a2?` (`table`) — Destination table; defaults to `a1`.

**Returns:**

- `table` — Destination table.

## table.pack

`table.pack(...): table`

Packs all arguments into a table with a count stored in field `n`.

**Returns:**

- `table` — Arguments at integer keys plus field `n`.

## table.remove

`table.remove(table, pos?)`

Removes and returns an element, shifting later elements down.

**Parameters:**

- `table` (`table`)
- `pos?` (`integer`) — Position; defaults to the last element.

**Returns:**

- Value — Removed value.

## table.select

`table.select(table, ...keys): table`
`table.select(table, keys): table`

Copies selected keys from a table into a new table.

**Parameters:**

- `table` (`table`)
- `keys` — Individual keys or one array-like table of keys.

**Returns:**

- `table`

**Example:**

```markdown
${query[[
  from p = index.pages()
  limit 3
  select table.select(p, "name", "lastModified")
]]}
```

## table.sort

`table.sort(table, comp?)`

Sorts a table in place using ascending order or an optional comparison function.

**Parameters:**

- `table` (`table`)
- `comp?` (`function`)

**Returns:**

- `table` — The sorted table in Space Lua.

**Example:**

```lua
local numbers = {3, 1, 2}
table.sort(numbers, function(a, b) return a > b end)
```

## table.unpack

`table.unpack(table, i?, j?)`

Returns the table values from index `i` through `j` as separate results.

**Parameters:**

- `table` (`table`)
- `i?` (`integer`)
- `j?` (`integer`)

**Returns:**

- Value — One result per selected element.

**Example:**

```lua
local second, third = table.unpack({"a", "b", "c"}, 2, 3)
```
<!--/lua-->

