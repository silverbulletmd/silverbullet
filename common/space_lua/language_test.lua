-- Basic checks
assert(true, "True is true")

-- Basic arithmetic
assert(1 + 2 == 3)
-- Slightly more complex arithmetic with presedence
assert(1 + 2 * 3 == 7)
-- Arithmetic with variables
local a = 1
local b = 2
assert(a + b == 3)

-- Basic string concatenation
assert("Hello " .. "world" == "Hello world")

-- Various forms of function definitions
function f1()
    return 1
end
assert(f1() == 1)

function sqr(a)
    return a * a
end

assert(sqr(2) == 4)

local f2 = function()
    return 2
end

assert(f2() == 2)

-- Using functions as arguments
function apply(f, a)
    return f(a)
end

assert(apply(sqr, 3) == 9)

-- Supporting multiple return values
function multi_return()
    return 1, 2
end
local a, b = multi_return()
assert(a == 1 and b == 2)

local a, b, c = 0, multi_return()
assert(a == 0 and b == 1 and c == 2)

-- Some table lookups
local t = { a = 1, b = 2 }
assert(t.a == 1 and t.b == 2)
assert(t["a"] == 1 and t["b"] == 2)

-- Unpacking tables
local a, b = unpack({ 1, 2 })
assert(a == 1 and b == 2)

-- Scope tests
local a = 1
do
    local a = 2
    assert(a == 2)
end
assert(a == 1)

-- Function definitions in tables
ns = { name = "Pete" }
function ns.returnOne()
    return 1
end

function ns:getName()
    return self.name
end

assert(ns.returnOne() == 1)
assert(ns.getName(ns) == "Pete")
-- Support colon syntax
assert(ns:getName() == "Pete")
-- Update the table
ns.name = "John"
assert(ns:getName() == "John")

-- Basic OOP with metatables
Person = {}
Person.__index = Person

-- Constructor
function Person:new(name, age)
    local self = setmetatable({}, Person)
    self.name = name
    -- Initialize object properties
    self.age = age
    return self
end

-- Method for the Person class
function Person:greet()
    return "Hello, my name is " .. self.name .. " and I am " .. self.age .. " years old."
end

-- Create a new instance of the Person class
local p = Person:new("John", 30)
assert(p:greet() == "Hello, my name is John and I am 30 years old.")

-- Metatables test
mt = {
    __index = function(table, key)
        return "Key not found: " .. key
    end
}

t = setmetatable({}, mt)
t.bar = "bar"
assert(t.bar == "bar")
assert(t.foo == "Key not found: foo")

-- Test the __newindex metamethod
t = setmetatable(
    {}, {
        __newindex = function(table, key, value)
            rawset(table, key, "Value: " .. value)
        end
    }
)

t.name = "John"
-- rawset ignores the metamethod
rawset(t, "age", 100)
assert(t.name == "Value: John")
assert(t.age == 100)

-- Test some of the operator metamethods
t = setmetatable(
    { 1, 2, 3 },
    {
        -- Assume b to be a same length table and add the two
        __add = function(a, b)
            local result = {}
            for i = 1, #a do
                result[i] = a[i] + b[i]
            end
            return result
        end,
        -- Assume b to be a scalar and multiply the table by it
        __mul = function(a, b)
            local result = {}
            for i = 1, #a do
                result[i] = a[i] * b
            end
            return result
        end
    }
)
local added = t + { 4, 5, 6 }
assert(added[1] == 5 and added[2] == 7 and added[3] == 9)
local muliplied = t * 2
assert(muliplied[1] == 2 and muliplied[2] == 4 and muliplied[3] == 6)

-- Let's try somethings lightly more complicated, like a deep comparison function implemented in Lua
function deepCompare(t1, t2)
    if t1 == t2 then return true end
    -- If they are the same object, return true
    if type(t1) ~= "table" or type(t2) ~= "table" then return false end
    -- If not both tables, return false
    -- Check if both tables have the same number of keys
    local t1_keys = 0
    local t2_keys = 0
    for k in pairs(t1) do
        t1_keys = t1_keys + 1
    end
    for k in pairs(t2) do
        t2_keys = t2_keys + 1
    end
    if t1_keys ~= t2_keys then return false end

    -- Recursively compare each key-value pair
    for k, v in pairs(t1) do
        if not deepCompare(v, t2[k]) then
            return false
        end
    end

    return true
end

assert(deepCompare({ 1, 2, 3 }, { 1, 2, 3 }))
assert(not deepCompare({ 1, 2, 3 }, { 1, 2 }))
assert(deepCompare({ a = 1, b = 2 }, { a = 1, b = 2 }))
assert(deepCompare(
    { a = { 1, 2, 3 }, b = { 4, 5, 6 } },
    { a = { 1, 2, 3 }, b = { 4, 5, 6 } }
))
assert(not deepCompare(
    { a = { 1, 2, 3 }, b = { 4, 5, 6 } },
    { a = { 1, 2, 3 }, b = { 4, 5, 7 } }
))