local function assertEqual(a, b)
    if a ~= b then
        error("Assertion failed: " .. a .. " is not equal to " .. b)
    end
end

-- Basic table operations
local t = { 1, 2, 3 }
table.insert(t, 4)
assertEqual(t[4], 4)
table.remove(t, 1)
table.remove(t)
assertEqual(t[2], 3)
assertEqual(#t, 2)

t = js.tojs({ 1, 2, 3 })
table.insert(t, 4)
assertEqual(t[4], 4)
table.remove(t, 1)
table.remove(t)
assertEqual(t[2], 3)
assertEqual(#t, 2)


-- Test concat
assertEqual(table.concat({ "Hello", "world" }, " "), "Hello world")
assertEqual(table.concat({ "Hello", "world", "three" }, " ", 2, 3), "world three")

-- Test with JavaScript array
assertEqual(table.concat(js.tojs({ "Hello", "world", "three" }), " ", 2, 3), "world three")

-- Table sorting
local t = { 3, 1, 2 }
table.sort(t)
assertEqual(t[1], 1)
assertEqual(t[2], 2)
assertEqual(t[3], 3)

-- Table sorting with custom comparator
table.sort(t, function(a, b)
    return a > b
end)
assertEqual(t[1], 3)
assertEqual(t[2], 2)
assertEqual(t[3], 1)

-- Table sorting with complex objects
local data = { { name = "John", age = 30 }, { name = "Jane", age = 25 } }
table.sort(data, function(a, b)
    return a.age < b.age
end)
assertEqual(data[1].name, "Jane")
assertEqual(data[2].name, "John")

-- Now the same with js.tojs
local data = js.tojs { 1, 3, 2 }
table.sort(data)
assertEqual(data[1], 1)
assertEqual(data[2], 2)
assertEqual(data[3], 3)

local data = js.tojs { { name = "John", age = 30 }, { name = "Jane", age = 25 } }
table.sort(data, function(a, b)
    return a.age < b.age
end)
assertEqual(data[1].name, "Jane")
assertEqual(data[2].name, "John")


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
    assertEqual(key, value)
end

-- for in over tables directly
local cnt = 1
for val in { 1, 2, 3 } do
    assertEqual(val, cnt)
    cnt = cnt + 1
end
assertEqual(cnt, 4)

local cnt = 1
for val in js.tojs({ 1, 2, 3 }) do
    assertEqual(val, cnt)
    cnt = cnt + 1
end
assertEqual(cnt, 4)

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

-- Test pack and unpack
local t = { 1, 2, 3 }
local packed = table.pack(table.unpack(t))
assertEqual(packed[1], 1)
assertEqual(packed[2], 2)
assertEqual(packed[3], 3)
assertEqual(packed.n, 3)
