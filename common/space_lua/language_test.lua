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

-- Async function calling
function multiplier(a)
    -- Anything will be async in practice
    return function(b)
        return a * b
    end
end

local multiplier = multiplier(2)
assert(multiplier(3) == 6)

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

-- Test string.gsub with various replacement types
-- Simple string replacement
local result, count = string.gsub("hello world", "hello", "hi")
assert(result == "hi world", "Basic string replacement failed")
assert(count == 1, "Basic replacement count failed")

-- Multiple replacements
result, count = string.gsub("hello hello hello", "hello", "hi")
assert(result == "hi hi hi", "Multiple replacements failed")
assert(count == 3, "Multiple replacement count failed")

-- Limited replacements with n parameter
result, count = string.gsub("hello hello hello", "hello", "hi", 2)
assert(result == "hi hi hello", "Limited replacements failed")
assert(count == 2, "Limited replacement count failed")

-- Function replacement without captures
result = string.gsub("hello world", "hello", function(match)
    assert(match == "hello", "Function received incorrect match")
    return string.upper(match)
end)
assert(result == "HELLO world", "Function replacement without captures failed")

-- Function replacement with single capture
result = string.gsub("hello world", "(h)ello", function(h)
    assert(h == "h", "Function received incorrect capture")
    return string.upper(h) .. "i"
end)
assert(result == "Hi world", "Function replacement with single capture failed")

-- Function replacement with multiple captures
result = string.gsub("hello world", "(h)(e)(l)(l)o", function(h, e, l1, l2)
    assert(h == "h" and e == "e" and l1 == "l" and l2 == "l",
        "Function received incorrect captures: " .. h .. ", " .. e .. ", " .. l1 .. ", " .. l2)
    return string.upper(h) .. string.upper(e) .. l1 .. l2 .. "o"
end)
assert(result == "HEllo world", "Function replacement with multiple captures failed")

-- Function returning nil (should keep original match)
result = string.gsub("hello world", "hello", function() return nil end)
assert(result == "hello world", "Function returning nil failed")

-- Pattern with multiple matches on same position
result = string.gsub("hello world", "h?e", "X")
assert(result == "Xllo world", "Overlapping matches failed")

-- Empty captures
result = string.gsub("hello", "(h()e)", function(full, empty)
    assert(full == "he" and empty == "", "Empty capture handling failed")
    return "XX"
end)
assert(result == "XXllo", "Empty capture replacement failed")

-- Patterns with magic characters
result = string.gsub("hello.world", "%.", "-")
assert(result == "hello-world", "Magic character replacement failed")

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


-- Advanced closure tests with multiple functions sharing state
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

-- Test varargs handling
-- Basic varargs sum function
local function sum(...)
    local total = 0
    for i, v in ipairs({ ... }) do
        total = total + v
    end
    return total
end

assert(sum() == 0, "Sum should handle no arguments")
assert(sum(42) == 42, "Sum should handle single argument")
assert(sum(1, 2) == 3, "Sum should handle two arguments")

-- Test varargs propagation
local function pass_varargs(...)
    return sum(...)
end

assert(pass_varargs() == 0, "Should propagate empty varargs")
assert(pass_varargs(1, 2, 3) == 6, "Should propagate varargs")

-- Test closure behavior
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

-- Test closures with shared upvalues
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


-- Test custom iterators
-- Basic iterator that counts down from n to 1
local function countdown(n)
    local count = n
    return function()
        if count > 0 then
            local current = count
            count = count - 1
            return current
        end
    end
end

-- Test basic iterator usage
local sum = 0
for num in countdown(3) do
    sum = sum + num
end
assert(sum == 6, "Countdown iterator should sum to 6 (3+2+1)")

-- Iterator that returns even numbers from an array
local function even_values(arr)
    local index = 0
    return function()
        repeat
            index = index + 1
            if index > #arr then return nil end
            if arr[index] % 2 == 0 then
                return index, arr[index]
            end
        until false
    end
end

-- Test array iterator
local arr = { 1, 2, 3, 4, 6, 7, 8 }
local count = 0
local sum = 0
for i, v in even_values(arr) do
    count = count + 1
    sum = sum + v
end
assert(count == 4, "Should find 4 even numbers")
assert(sum == 20, "Sum of even numbers should be 20 (2+4+6+8)")

-- Range iterator with step
local function range(from, to, step)
    step = step or 1
    local current = from
    return function()
        if current > to then
            return nil
        end
        local value = current
        current = current + step
        return value
    end
end

-- Test range iterator with different steps
local function collect_range(from, to, step)
    local values = {}
    for v in range(from, to, step) do
        table.insert(values, v)
    end
    return values
end

local values1 = collect_range(1, 5, 2)
assert(#values1 == 3, "Range with step 2 should return 3 values")
assert(values1[1] == 1 and values1[2] == 3 and values1[3] == 5, "Range values with step 2 should be correct")

local values2 = collect_range(10, 15)
assert(#values2 == 6, "Range with default step should return 6 values")
assert(values2[1] == 10 and values2[6] == 15, "Range values with default step should be correct")

local values3 = collect_range(1, 10, 3)
assert(#values3 == 4, "Range with step 3 should return 4 values")
assert(values3[1] == 1 and values3[2] == 4 and values3[3] == 7 and values3[4] == 10,
    "Range values with step 3 should be correct")

-- Test nested iterators
local function grid(rows, cols)
    local row = 0
    return function()
        row = row + 1
        if row <= rows then
            local col = 0
            return function()
                col = col + 1
                if col <= cols then
                    return row, col
                end
            end
        end
    end
end

local points = {}
for row_iter in grid(2, 3) do
    for r, c in row_iter do
        table.insert(points, { r, c })
    end
end

assert(#points == 6, "Grid should generate 6 points")
assert(points[1][1] == 1 and points[1][2] == 1, "First point should be (1,1)")
assert(points[6][1] == 2 and points[6][2] == 3, "Last point should be (2,3)")

-- Test space_lua stuff
local parsedExpr = space_lua.parse_expression("1 + 1")
local evalResult = space_lua.eval_expression(parsedExpr)
assert(evalResult == 2, "Eval should return 2")

-- Slightly more advanced example with augmented environment
local parsedExpr = space_lua.parse_expression("tostring(a + 1)")
local evalResult = space_lua.eval_expression(parsedExpr, { a = 1 })
assert(evalResult == "2", "Eval should return 2 as a string")

-- Test query
local data = { { name = "John", lastModified = 1, age = 20 }, { name = "Jane", lastModified = 2, age = 21 } }
local r = query [[from p = data limit 1]]
assert_equal(#r, 1)
assert_equal(r[1].name, "John")
assert_equal(r[1].lastModified, 1)

local r = query [[from p = data order by p.lastModified desc]]
assert_equal(#r, 2)
assert_equal(r[1].name, "Jane")
assert_equal(r[1].lastModified, 2)
assert_equal(r[2].name, "John")
assert_equal(r[2].lastModified, 1)

local r = query [[from p = data order by p.lastModified]]
assert_equal(#r, 2)
assert_equal(r[1].name, "John")
assert_equal(r[1].lastModified, 1)
assert_equal(r[2].name, "Jane")
assert_equal(r[2].lastModified, 2)

local r = query [[from p = data order by p.age select {name=p.name, age=p.age}]]
assert_equal(#r, 2)
assert_equal(r[1].name, "John")
assert_equal(r[1].age, 20)
assert_equal(r[2].name, "Jane")
assert_equal(r[2].age, 21)
assert_equal(r[1].lastModified, nil)
assert_equal(r[2].lastModified, nil)
