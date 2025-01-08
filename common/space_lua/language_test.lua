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

-- Closure tests
local function make_counter()
    local count = 0
    return function()
        count = count + 1
        return count
    end
end

local counter1 = make_counter()
local counter2 = make_counter()
assert(counter1() == 1, "First counter first call")
assert(counter1() == 2, "First counter second call")
assert(counter2() == 1, "Second counter should be independent")
assert(counter1() == 3, "First counter maintains state")

-- Test nested closures
local function make_adder(x)
    return function(y)
        return function(z)
            return x + y + z
        end
    end
end

local add5 = make_adder(5)
local add5and2 = add5(2)
assert(add5and2(3) == 10, "Nested closure should maintain all scopes")

-- Test closure variable independence
local function make_value_keeper()
    local value = 0
    return {
        set = function(v) value = v end,
        get = function() return value end
    }
end

local keeper1 = make_value_keeper()
local keeper2 = make_value_keeper()
keeper1.set(5)
keeper2.set(10)
assert(keeper1.get() == 5, "First keeper maintains its own value")
assert(keeper2.get() == 10, "Second keeper maintains its own value")

-- Test closure over loop variables
local functions = {}
for i = 1, 3 do
    functions[i] = function() return i end
end
assert(functions[1]() == 1, "Closure should capture loop variable value at creation time")
assert(functions[2]() == 2, "Each closure should have its own value")
assert(functions[3]() == 3, "Each closure should have its own value")

-- Test closure over mutating variables
local function make_accumulator(initial)
    local sum = initial
    return {
        add = function(x) sum = sum + x end,
        get = function() return sum end
    }
end

local acc = make_accumulator(5)
acc.add(3)
acc.add(2)
assert(acc.get() == 10, "Accumulator should maintain state through multiple calls")

-- Test closures with upvalues modified in nested scopes
local function make_counter_with_reset()
    local count = 0
    return {
        increment = function()
            local old = count
            count = count + 1
            return old
        end,
        reset = function()
            local old = count
            count = 0
            return old
        end
    }
end

local counter = make_counter_with_reset()
assert(counter.increment() == 0)
assert(counter.increment() == 1)
local final = counter.reset()
assert(final == 2, "Reset should return last value")
assert(counter.increment() == 0, "Counter should start fresh after reset")

print("All closure tests passed!")

-- Advanced closure tests with multiple functions sharing state
local function test_advanced_closures()
    -- Counter that can count by custom steps
    local function make_counter_with_step()
        local count = 0
        return {
            increment = function(step)
                count = count + (step or 1)
                return count
            end,
            decrement = function(step)
                count = count - (step or 1)
                return count
            end,
            get = function()
                return count
            end
        }
    end

    local counter = make_counter_with_step()
    assert(counter.increment(5) == 5, "Counter should increment by 5")
    assert(counter.decrement(2) == 3, "Counter should decrement by 2")
    assert(counter.get() == 3, "Counter should maintain state")
    assert(counter.increment() == 4, "Counter should default to 1")

    -- Test multiple independent counters
    local c1 = make_counter_with_step()
    local c2 = make_counter_with_step()
    c1.increment(10)
    c2.increment(5)
    assert(c1.get() == 10, "First counter should be independent")
    assert(c2.get() == 5, "Second counter should be independent")
end

-- Test closures with shared upvalues
local function test_shared_closures()
    local function make_shared_counter()
        local count = 0
        local function inc()
            count = count + 1
            return count
        end
        local function dec()
            count = count - 1
            return count
        end
        local function get()
            return count
        end
        return inc, dec, get
    end

    local inc, dec, get = make_shared_counter()
    assert(inc() == 1, "First increment")
    assert(inc() == 2, "Second increment")
    assert(dec() == 1, "First decrement")
    assert(get() == 1, "Get should return current value")
end

-- Test varargs handling
local function test_varargs()
    -- Basic varargs sum function
    local function sum(...)
        local args = { ... }
        local total = 0
        for _, v in ipairs(args) do
            total = total + v
        end
        return total
    end

    assert(sum(1, 2, 3, 4, 5) == 15, "Sum should handle multiple arguments")
    assert(sum() == 0, "Sum should handle no arguments")
    assert(sum(42) == 42, "Sum should handle single argument")

    -- Test varargs propagation
    local function pass_varargs(...)
        return sum(...)
    end

    assert(pass_varargs(1, 2, 3) == 6, "Should propagate varargs")
    assert(pass_varargs() == 0, "Should propagate empty varargs")

    -- Test mixing regular args with varargs
    local function first_plus_sum(first, ...)
        local args = { ... }
        local total = first or 0
        for _, v in ipairs(args) do
            total = total + v
        end
        return total
    end

    assert(first_plus_sum(10, 1, 2, 3) == 16, "Should handle mixed arguments")
    assert(first_plus_sum(5) == 5, "Should handle only first argument")
end

-- Test closure edge cases
local function test_closure_edge_cases()
    -- Test closure over loop variables
    local closures = {}
    for i = 1, 3 do
        closures[i] = function() return i end
    end

    assert(closures[1]() == 1, "Should capture loop variable")
    assert(closures[2]() == 2, "Should capture loop variable")
    assert(closures[3]() == 3, "Should capture loop variable")

    -- Test nested closure scopes
    local function make_nested_counter(start)
        local count = start
        return function()
            local function increment()
                count = count + 1
                return count
            end
            return increment()
        end
    end

    local counter1 = make_nested_counter(5)
    local counter2 = make_nested_counter(10)
    assert(counter1() == 6, "First nested counter")
    assert(counter1() == 7, "First nested counter increment")
    assert(counter2() == 11, "Second nested counter independent")
end

-- Run the new tests
test_advanced_closures()
test_shared_closures()
test_varargs()
test_closure_edge_cases()
print("All closure and varargs tests passed!")
