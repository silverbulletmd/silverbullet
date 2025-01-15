local function assert_equal(a, b)
    if a ~= b then
        error("Assertion failed: " .. a .. " is not equal to " .. b)
    end
end

-- Basic table operations
local t = { 1, 2, 3 }
table.insert(t, 4)
assert_equal(t[4], 4)
table.remove(t, 1)
assert_equal(t[1], 2)
table.insert(t, 1, 1)
assert_equal(t[1], 1)
assert_equal(table.concat({ "Hello", "world" }, " "), "Hello world")

-- Table sorting
local t = { 3, 1, 2 }
table.sort(t)
assert_equal(t[1], 1)
assert_equal(t[2], 2)
assert_equal(t[3], 3)

-- Table sorting with custom comparator
table.sort(t, function(a, b)
    return a > b
end)
assert_equal(t[1], 3)
assert_equal(t[2], 2)
assert_equal(t[3], 1)

-- Table sorting with complex objects
local data = { { name = "John", age = 30 }, { name = "Jane", age = 25 } }
table.sort(data, function(a, b)
    return a.age < b.age
end)
assert_equal(data[1].name, "Jane")
assert_equal(data[2].name, "John")

-- ipairs tests
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

-- pairs tests
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

-- for in over tables directly
local cnt = 1
for val in { 1, 2, 3 } do
    assert_equal(val, cnt)
    cnt = cnt + 1
end
assert_equal(cnt, 4)

local cnt = 1
for val in js.tojs({ 1, 2, 3 }) do
    assert_equal(val, cnt)
    cnt = cnt + 1
end
assert_equal(cnt, 4)

-- Table keys tests
local t = { a = 1, b = 2, c = 3 }
local keys = table.keys(t)
assert(table.includes(keys, "a"))
assert(table.includes(keys, "b"))
assert(table.includes(keys, "c"))

-- Table includes tests with different value types
local t = { 1, 2, "three", true }
assert(table.includes(t, 1))
assert(table.includes(t, "three"))
assert(table.includes(t, true))
assert(not table.includes(t, "missing"))


-- Error cases
local success, error = pcall(function()
    table.includes("not a table", 1)
end)
assert(not success)
assert(string.find(error, "Cannot use includes")) 