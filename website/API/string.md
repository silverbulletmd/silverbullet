API docs for Lua's `string` module.

**Note:** since string values set `string` as their meta table, these APIs can also be called as method calls on strings directly. For instance: `someString:startsWith("h")` is equivalent to `string.startsWith(someString, "h")`.

## string.byte(s, i?, j?)
Returns the numeric codes of characters in string `s` from position `i` to `j`. If `j` is not provided, defaults to `i`.

Example:
```lua
print(string.byte("Hello", 1))  -- prints: 72 (ASCII code for 'H')
```

## string.char(...)
Returns a string from given ASCII codes.

Example:
```lua
print(string.char(72))  -- prints: H
```

## string.find(s, pattern, init?, plain?)
Looks for the first match of `pattern` in string `s`. Returns start and end indices of match.

Example:
```lua
local start, end_ = string.find("Hello", "l")
print(start)  -- prints: 3 (first 'l' position)
```

## string.gsub(s, pattern, repl, n?)
Returns a copy of `s` in which all (or the first `n`) occurrences of `pattern` have been replaced by `repl`.

Example:
```lua
-- Simple string replacement
local result, count = string.gsub("hello world", "hello", "hi")
print(result, count)  -- prints: hi world 1

-- Multiple replacements with limit
result = string.gsub("hello hello hello", "hello", "hi", 2)
print(result)  -- prints: hi hi hello

-- Function replacement
result = string.gsub("hello world", "(h)ello", function(h)
    return string.upper(h) .. "i"
end)
print(result)  -- prints: Hi world

-- Pattern with magic characters
result = string.gsub("hello.world", "%.", "-")
print(result)  -- prints: hello-world
```

## string.match(s, pattern, init?)
Returns the captures from the first match of `pattern` in string `s`.

Example:
```lua
-- Basic pattern matching
print(string.match("hello", "h"))  -- prints: h

-- Multiple captures
local day, month, year = string.match("2024-03-14", "(%d+)-(%d+)-(%d+)")
print(day, month, year)  -- prints: 2024 03 14

-- With init position
print(string.match("hello world", "(world)", 7))  -- prints: world

-- Pattern characters
print(string.match("123", "%d+"))      -- prints: 123
print(string.match("abc123", "%a+"))   -- prints: abc
print(string.match("   abc", "%s+"))   -- prints: "   "
```

## string.gmatch(s, pattern)
Returns an iterator function that returns successive captures from pattern matches in string `s`.

Example:
```lua
local words = {}
for word in string.gmatch("hello world lua", "%w+") do
    table.insert(words, word)
end
print(words[1], words[2], words[3])  -- prints: hello world lua
```

## string.len(s)
Returns the length of string `s`.

Example:
```lua
print(string.len("Hello"))  -- prints: 5
```

## string.lower(s)
Returns a copy of `s` with all characters converted to lowercase.

Example:
```lua
print(string.lower("Hello"))  -- prints: hello
```

## string.upper(s)
Returns a copy of `s` with all characters converted to uppercase.

Example:
```lua
print(string.upper("Hello"))  -- prints: HELLO
```

## string.rep(s, n, sep?)
Returns a string that is the concatenation of `n` copies of string `s`.

Example:
```lua
print(string.rep("Hello", 3))  -- prints: HelloHelloHello
```

## string.reverse(s)
Returns a string with the characters of `s` in reverse order.

Example:
```lua
print(string.reverse("hello"))  -- prints: olleh
print(string.reverse(""))       -- prints: "" (empty string)
```

## string.sub(s, i, j?)
Returns the substring of `s` from position `i` to `j`.

Example:
```lua
print(string.sub("Hello", 2, 4))  -- prints: ell
```

## string.split(s, sep)
Splits string `s` using separator `sep` and returns a table of substrings.

Example:
```lua
local parts = string.split("a,b,c", ",")
for i, part in ipairs(parts) do
    print(part)
end
-- Output:
-- a
-- b
-- c
```

# Non-standard Extensions
## string.startsWith(s, prefix)
Returns true if string `s` starts with `prefix`.

Example:
```lua
print(string.startsWith("hello world", "hello"))  -- prints: true
print(string.startsWith("hello world", "world"))  -- prints: false
```

## string.endsWith(s, suffix)
Returns true if string `s` ends with `suffix`.

Example:
```lua
print(string.endsWith("hello world", "world"))  -- prints: true
print(string.endsWith("hello world", "hello"))  -- prints: false
```