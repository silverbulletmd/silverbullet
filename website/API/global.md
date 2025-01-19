These are Lua functions defined in the global namespace:

# Standard Lua
## print(...)
Prints to your log (browser or server log).

Example:

```lua
print("Hello, world!")
```

## assert(expr, message?)
Asserts `expr` to be true otherwise raises an [[#error(message)]]

Example:

```lua
assert(1 == 2, "1 is not equal to 2")
```

## ipairs
Returns an iterator for array-like tables that iterates over numeric indices in order.

Example:
```lua
local fruits = {"apple", "banana", "orange"}
for i, fruit in ipairs(fruits) do
    print(i, fruit)
end
-- Output:
-- 1 apple
-- 2 banana
-- 3 orange
```

## pairs
Returns an iterator for tables that traverses all keys and values.

Example:
```lua
local person = {name = "John", age = 30, city = "New York"}
for key, value in pairs(person) do
    print(key, value)
end
-- Output (order not guaranteed):
-- name John
-- age 30
-- city New York
```

## each
Returns an iterator for array-like tables that iterates over values only (without indices).

Example:
```lua
local fruits = {"apple", "banana", "orange"}
for fruit in each(fruits) do
    print(fruit)
end
-- Output:
-- apple
-- banana
-- orange
```

## unpack
Unpacks a table into individual values.

Example:
```lua
local numbers = {10, 20, 30}
print(unpack(numbers))  -- prints: 10 20 30

local function sum(a, b, c)
    return a + b + c
end
print(sum(unpack(numbers)))  -- prints: 60
```

## type
Returns the type of a value as a string.

Example:
```lua
print(type("hello"))    -- string
print(type(42))         -- number
print(type({}))         -- table
print(type(print))      -- function
print(type(nil))        -- nil
print(type(true))       -- boolean
```

## tostring
Converts a value to a string representation.

Example:
```lua
print(tostring(42))           -- "42"
print(tostring(true))         -- "true"
print(tostring({1, 2, 3}))    -- "{1, 2, 3}"
```

## tonumber
Converts a string to a number, returns nil if conversion fails.

Example:
```lua
print(tonumber("42"))      -- 42
print(tonumber("3.14"))    -- 3.14
print(tonumber("abc"))     -- nil
```

## error(message)
Throw an error.

Example: 
```lua
error("FAIL")
```

## pcall
Protected call - executes a function in protected mode, catching errors.

Example:
```lua
local status, result = pcall(function()
    return 10/0  -- will cause an error
end)
print(status)  -- false
print(result)  -- "attempt to divide by zero"

status, result = pcall(function()
    return 10/2  -- will succeed
end)
print(status)  -- true
print(result)  -- 5
```

## xpcall
Like pcall, but allows you to specify an error handler function.

Example:
```lua
local function errorHandler(err)
    return "Error occurred: " .. tostring(err)
end

local status, result = xpcall(function()
    error("something went wrong")
end, errorHandler)
print(status)  -- false
print(result)  -- "Error occurred: something went wrong"
```

## setmetatable
Sets the metatable for a table.

Example:
```lua
local t1 = {value = 10}
local t2 = {value = 20}
local mt = {
    __add = function(a, b)
        return a.value + b.value
    end
}
setmetatable(t1, mt)
setmetatable(t2, mt)

-- Now we can add the tables together using the + operator
print(t1 + t2)  -- prints: 30
```

## getmetatable
Gets the metatable of a table.

Example:
```lua
local t = {}
local mt = {}
setmetatable(t, mt)
print(getmetatable(t) == mt)  -- true
```

## rawset
Sets a table index without invoking metamethods.

Example:
```lua
local t = {}
local mt = {
    __newindex = function(t, k, v)
        print("Blocked setting:", k, v)
    end
}
setmetatable(t, mt)

t.foo = "bar"  -- prints: "Blocked setting: foo bar"
rawset(t, "foo", "bar")  -- bypasses the metamethod
print(t.foo)  -- prints: "bar"
```

## dofile(path)
Loads a Lua file from a path in your space, e.g. if you uploaded a `test.lua` file, you can load it with `dofile("test.lua")`.