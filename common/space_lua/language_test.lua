local function assert_equal(a, b)
    if a ~= b then
        error("Assertion failed: " .. a .. " is not equal to " .. b)
    end
end

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

-- Basic string stuff
assert("Hello " .. "world" == "Hello world")
assert_equal([[Hello world]], "Hello world")
assert_equal([==[Hello [[world]]!]==], "Hello [[world]]!")

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
assert_equal(t.foo, "Key not found: foo")

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

-- String serialization
assert(tostring({ 1, 2, 3 }) == "{1, 2, 3}")
assert(tostring({ a = 1, b = 2 }) == "{a = 1, b = 2}")

-- Error handling
local status, err = pcall(function()
    error("This is an error")
end)

assert(not status)
assert(err == "This is an error")

local status, err = xpcall(function()
    error("This is an error")
end, function(err)
    return "Caught error: " .. err
end)

assert(not status)
assert_equal(err, "Caught error: This is an error")

-- ipairs
local p = ipairs({ 3, 2, 1 })
local idx, value = p()
assert(idx == 1 and value == 3)
idx, value = p()
assert(idx == 2 and value == 2)
idx, value = p()
assert(idx == 3 and value == 1)
idx, value = p()
assert(idx == nil and value == nil)

for index, value in ipairs({ 1, 2, 3 }) do
    assert(index == value)
end

-- pairs
local p = pairs({ a = 1, b = 2, c = 3 })
local key, value = p()
assert(key == "a" and value == 1)
key, value = p()
assert(key == "b" and value == 2)
key, value = p()
assert(key == "c" and value == 3)
key, value = p()
assert(key == nil and value == nil)
for key, value in pairs({ a = "a", b = "b" }) do
    assert_equal(key, value)
end

-- type
assert(type(1) == "number")
assert(type("Hello") == "string")
assert(type({}) == "table")
assert(type(nil) == "nil")
assert(type(true) == "boolean")
assert_equal(type(function() end), "function")

-- string functions
assert(string.len("Hello") == 5)
assert(string.byte("Hello", 1) == 72)
assert(string.char(72) == "H")
assert(string.find("Hello", "l") == 3)
assert(string.rep("Hello", 3) == "HelloHelloHello")
assert(string.sub("Hello", 2, 4) == "ell")
assert(string.upper("Hello") == "HELLO")
assert(string.lower("Hello") == "hello")

-- table functions
local t = { 1, 2, 3 }
table.insert(t, 4)
assert_equal(t[4], 4)
table.remove(t, 1)
assert_equal(t[1], 2)
table.insert(t, 1, 1)
assert_equal(t[1], 1)
assert_equal(table.concat({ "Hello", "world" }, " "), "Hello world")

local t = { 3, 1, 2 }
table.sort(t)
assert_equal(t[1], 1)
assert_equal(t[2], 2)
assert_equal(t[3], 3)
table.sort(t, function(a, b)
    return a > b
end)
assert_equal(t[1], 3)
assert_equal(t[2], 2)
assert_equal(t[3], 1)

local data = { { name = "John", age = 30 }, { name = "Jane", age = 25 } }
table.sort(data, function(a, b)
    return a.age < b.age
end)
assert_equal(data[1].name, "Jane")
assert_equal(data[2].name, "John")

-- os functions
assert(os.time() > 0)
assert(os.date("%Y-%m-%d", os.time({ year = 2020, month = 1, day = 1 })) == "2020-01-01")
