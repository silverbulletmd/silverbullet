local function assertEqual(a, b, message)
    if a ~= b then
        error("Assertion failed: " .. a .. " is not equal to " .. b .. " " .. message)
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
assertEqual([[Hello world]], "Hello world")
assertEqual([==[Hello [[world]]!]==], "Hello [[world]]!")
-- First newline should be eliminated if present
assertEqual([==[
Hello world]==], "Hello world")

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

function addAll(...)
    local total = 0
    for i, v in ipairs({ ... }) do
        total = total + v
    end
    return total
end

local a, b = multi_return()
assert(a == 1 and b == 2)
assert(addAll(1, 2, 3) == 6)
-- Test multiple return values in expressions
assertEqual(addAll(multi_return()), 3)
assertEqual(#{ multi_return() }, 2)

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


-- Comprehensive pairs and ipairs tests
-- Test empty table behavior
local empty = {}
local count = 0
for _ in pairs(empty) do
    count = count + 1
end
assertEqual(count, 0, "pairs should not iterate over empty table")

count = 0
for _ in ipairs(empty) do
    count = count + 1
end
assertEqual(count, 0, "ipairs should not iterate over empty table")

-- Test ipairs with js arrays
local emptyJS = js.window.JSON.parse("[]")
for i, v in ipairs(emptyJS) do
    assert(false, "ipairs should not iterate over empty js array")
end

for i, v in ipairs(js.window.JSON.parse("null") or {}) do
    assert(false, "ipairs should not iterate over empty js array")
end


-- Test mixed key types
local mixed = {
    [1] = "one",
    [2] = "two",
    ["a"] = "alpha",
    ["b"] = "beta",
    [3] = "three"
}

-- Test pairs iteration order (should include all keys)
local pairs_keys = {}
local pairs_values = {}
for k, v in pairs(mixed) do
    table.insert(pairs_keys, k)
    table.insert(pairs_values, v)
end
assertEqual(#pairs_keys, 5, "pairs should iterate over all keys")
assertEqual(#pairs_values, 5, "pairs should iterate over all values")

-- Test ipairs behavior (should only iterate over numeric indices)
local ipairs_keys = {}
local ipairs_values = {}
for k, v in ipairs(mixed) do
    table.insert(ipairs_keys, k)
    table.insert(ipairs_values, v)
end
assertEqual(#ipairs_keys, 3, "ipairs should only iterate over numeric indices")
assertEqual(ipairs_values[1], "one", "first ipairs value should be 'one'")
assertEqual(ipairs_values[2], "two", "second ipairs value should be 'two'")
assertEqual(ipairs_values[3], "three", "third ipairs value should be 'three'")

-- Async function calling
function multiplier(a)
    -- Anything will be async in practice
    return function(b)
        return a * b
    end
end

local multiplier = multiplier(2)
assert(multiplier(3) == 6)

-- Checking of pairs and ipairs


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
assertEqual(t.foo, "Key not found: foo")

-- Test the __newindex metamethod
t, c = setmetatable(
    {}, {
        __newindex = function(table, key, value)
	    c = c + 1
            rawset(table, key, "Value: " .. value)
	    c = c + 1
        end
    }
), 0

t.name = "John"
-- rawset ignores the metamethod
rawset(t, "age", 100)
assertEqual(t.name, "Value: John")
assertEqual(t.age, 100)
assertEqual(c, 2)

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

-- __call Metamethod

local ts = {
    foo = "ARG 2"
}
local mt = {}

function mt.__call(table, arg1)
    assert(arg1 == "ARG 1")
    assert(table.foo == "ARG 2")
    return "return from metatable"
end

setmetatable(ts, mt)

assert(ts("ARG 1") == "return from metatable")

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

local tblNew = { 1, 2, 3 }
table.insert(tblNew, 4)
assertEqual(#tblNew, 4)
assertEqual(tblNew[4], 4)

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

-- Test for functions with variable number of arguments
function sum(...)
    local total = 0
    for i, v in ipairs({ ... }) do
        total = total + v
    end
    return total
end

assertEqual(sum(1, 2, 3), 6)
assertEqual(sum(1, 2, 3, 4, 5), 15)

local data = { { name = "John", favorite = { color = "blue" } }, { name = "Jane" } }
assertEqual(type(data[1].favorite), "table")
assertEqual(data[1].favorite.color, "blue")

local r = query [[from p = data where type(p.favorite) == "table" and p.favorite.color == "blue"]]
assertEqual(#r, 1)
assertEqual(r[1].name, "John")

-- Test string to number coercion for arithmetical operations
assertEqual(-1*' 16 '    ==  -16,  true)
assertEqual(0-'0X10'     ==  -16,  true)
assertEqual('-0x10'/1    ==  -16,  true)
assertEqual('-0X10p0'//1 ==  -16,  true)
assertEqual('0x10P0'%15  ==   1,   true)
assertEqual('0X10P-1'^-1 == 0.125, true)
assertEqual(-'16'        ==  -16,  true)

-- select tests
-- Base case
local a, b, c = select(1, 1, 2, 3)
assertEqual(a, 1)
assertEqual(b, 2)
assertEqual(c, 3)
-- One index later
local b, c = select(2, 1, 2, 3)
assertEqual(b, 2)
assertEqual(c, 3)
-- Negative index
local b, c = select(-2, 1, 2, 3)
assertEqual(b, 2)
assertEqual(c, 3)
-- Special "#" case
assertEqual(select("#", 1, 2, 3), 3)

-- next tests
local tbl = {a = "a value", b = "b value"}
-- base cases
assertEqual(next(nil), nil, "nil table case")
assertEqual(next({}), nil, "nil table case")
-- find first key (although this is not specified, we know this will be "a" in space lua)
local k, v = next(tbl)
assertEqual(k, "a")
assertEqual(v, "a value")
-- find the second key
local k, v = next(tbl, k)
assertEqual(k, "b")
assertEqual(v, "b value")
-- and now we should be done
assertEqual(next(tbl, k), nil)

-- Some more vararg verification
function varArgTest(a0, ...)
    -- ... gets the multi arg treatment
    local a1, a2 = ...
    assertEqual(a0, 1)
    assertEqual(a1, 2)
    assertEqual(a2, 3)
end

varArgTest(1, 2, 3, 4)

-- Some `rawlen` tests

-- Strings
assertEqual(rawlen(""), 0, "rawlen on empty string")
assertEqual(rawlen("abc"), 3, "rawlen on non-empty string")

-- Tables
assertEqual(rawlen({}), 0, "rawlen on empty table")
assertEqual(rawlen({1, 2, 3}), 3, "rawlen on array table")

-- `rawlen` ignores `__len` metamethod
do
  local t = {}
  setmetatable(t, { __len = function(_) return 42 end })
  assertEqual(rawlen(t), 0, "rawlen ignores __len (no array part)")
  t[1] = "x"; t[2] = "y"
  assertEqual(rawlen(t), 2, "rawlen returns raw array-part length")
end

-- JS arrays also have raw length
do
  local a0 = js.window.JSON.parse("[]")
  assertEqual(rawlen(a0), 0, "rawlen on empty JS array")

  local a4 = js.window.JSON.parse("[1,2,3,4]")
  assertEqual(rawlen(a4), 4, "rawlen on JS array length 4")
end

-- Non-string/non-table must error with proper message
local function expect_rawlen_error(v, typeName)
  local ok, err = pcall(
    function()
      return rawlen(v)
    end
  )

  assertEqual(ok, false, "rawlen must error on "
    .. tostring(typeName))

  local s = tostring(err)

  assert(
    string.find(s, "bad argument #1 to 'rawlen'", 1, true) ~= nil,
    "error must mention rawlen"
  )

  assert(
    string.find(s, typeName, 1, true) ~= nil,
    "error must mention type name"
  )
end

expect_rawlen_error(nil, "nil")
expect_rawlen_error(1, "number")
expect_rawlen_error(false, "boolean")
expect_rawlen_error(function() end, "function")

-- Some `rawget` tests

-- Tables
do
  local t = { "a", "b" }

  assertEqual(rawget(t, 1), "a")
  assertEqual(rawget(t, 2), "b")
  assertEqual(rawget(t, 3), nil, "rawget missing key returns nil")
end

-- `rawget` ignores `__index` metamethod
do
  local t = {}

  setmetatable(
    t,
    {
      __index = function()
        return "X"
      end
    }
  )

  assertEqual(rawget(t, "k"), nil, "rawget must ignore __index")

  t.k = "v"
  assertEqual(rawget(t, "k"), "v")
end

-- JS arrays
do
  local a = js.window.JSON.parse("[1, 2, 3]")

  assertEqual(rawget(a, 1), 1)
  assertEqual(rawget(a, 2), 2)
  assertEqual(rawget(a, 4), nil)
end

-- Plain JS objects
do
  local o = js.window.JSON.parse('{ "a": 1, "b": null }')

  assertEqual(rawget(o, "a"), 1)
  assertEqual(rawget(o, "b"), nil)
  assertEqual(rawget(o, "c"), nil)
end

-- `rawget` argument errors
local function expect_rawget_error(v, typeName)
  local ok, err = pcall(
    function()
      return rawget(v, "k")
    end
  )

  assertEqual(ok, false, "rawget must error on " .. tostring(typeName))

  local s = tostring(err)

  assert(
    string.find(s, "bad argument #1 to 'rawget'", 1, true) ~= nil,
    "error must mention rawget"
  )

  assert(
    string.find(s, typeName, 1, true) ~= nil,
    "error must mention type name"
  )
end

expect_rawget_error(nil, "nil")
expect_rawget_error(1, "number")
expect_rawget_error(false, "boolean")
expect_rawget_error(function() end, "function")

-- Some `rawequal` tests
do
  -- Primitives
  assertEqual(rawequal(1, 1), true)
  assertEqual(rawequal(1, 2), false)
  assertEqual(rawequal("x", "x"), true)
  assertEqual(rawequal("x", "y"), false)

  -- Tables: identity vs structural equality
  local t1 = {}
  local t2 = {}

  assertEqual(rawequal(t1, t1), true)
  assertEqual(rawequal(t1, t2), false)

  -- NaN is not equal to NaN
  local nan = 0/0

  assertEqual(rawequal(nan, nan), false)
end

-- Some `..` (concatenation) tests

-- Strings and numbers
assertEqual("a" .. "b", "ab")
assertEqual(1 .. "b", "1b")
assertEqual("a" .. 2, "a2")
assertEqual(4 .. 2, "42")
assertEqual("123" .. 45, "12345")

-- Multi-return (only first value is used)
do
  local function f()
    return "X", "Y"
  end

  assertEqual("A" .. f(), "AX")

  local function g()
    return 1, 2
  end

  assertEqual(g() .. "X", "1X")
end

local function expect_concat_nil_error(lhs, rhs)
  local ok, err = pcall(
    function()
      return lhs .. rhs
    end
  )

  assertEqual(ok, false, "concat must error on nil")
end

local function expect_concat_type_error(lhs, rhs)
  local ok, err = pcall(
    function()
      return lhs .. rhs
    end
  )

  assertEqual(ok, false, "concat must error on non-string/non-number")
end

-- Nil on either side
expect_concat_nil_error(nil, "x")
expect_concat_nil_error("x", nil)
expect_concat_nil_error(nil, 1)
expect_concat_nil_error(1, nil)
expect_concat_nil_error(nil, nil)

-- Non-string and non-number must error
expect_concat_type_error(true, "x")
expect_concat_type_error("x", false)
expect_concat_type_error(true, true)

do
  local t = {}

  expect_concat_type_error(t, "x")
  expect_concat_type_error("x", t)
  expect_concat_type_error(t, t)
end

-- JS arrays and JS objects behave as tables (no concat)
do
  local arr = js.window.JSON.parse("[1, 2]")

  expect_concat_type_error(arr, "x")
  expect_concat_type_error("x", arr)
  expect_concat_type_error(arr, arr)

  local obj = js.window.JSON.parse('{ "a": 1 }')

  expect_concat_type_error(obj, "x")
  expect_concat_type_error("x", obj)
  expect_concat_type_error(obj, obj)
end

-- `__tostring` alone does not relax concat rules
do
  local t = {}

  setmetatable(
    t,
    {
      __tostring = function(_)
        return "T"
      end
    }
  )

  expect_concat_type_error(t, "x")
  expect_concat_type_error("x", t)
  expect_concat_type_error(t, t)
end

-- `__concat` metamethod cases
do
  local L = {}

  setmetatable(
    L,
    {
      __concat = function(a, b)
        return "LEFT"
      end
    }
  )

  assertEqual(L .. "x", "LEFT")

  local R = {}

  setmetatable(
    R,
    {
      __concat = function(a, b)
        return "RIGHT"
      end
    }
  )

  assertEqual("x" .. R, "RIGHT")

  assertEqual(L .. R, "LEFT",
    "left-side __concat must be preferred when both defined")
end

-- `__concat` result handling (only first value used)
do
  local M = {}

  setmetatable(
    M,
    {
      __concat = function(a, b)
        return "A", "B"
      end
    }
  )

  assertEqual(M .. "x", "A",
    "__concat must use only first return value")
end
