local function assert_equal(a, b)
    if a ~= b then
        error("Assertion failed: " .. a .. " is not equal to " .. b)
    end
end

-- Test query functionality
local data = { { name = "John", lastModified = 1, age = 20 }, { name = "Jane", lastModified = 2, age = 21 } }

-- Basic limit query
local r = query [[from p = data limit 1]]
assert_equal(#r, 1)
assert_equal(r[1].name, "John")
assert_equal(r[1].lastModified, 1)

-- Order by descending
local r = query [[from p = data order by p.lastModified desc]]
assert_equal(#r, 2)
assert_equal(r[1].name, "Jane")
assert_equal(r[1].lastModified, 2)
assert_equal(r[2].name, "John")
assert_equal(r[2].lastModified, 1)

-- Order by ascending
local r = query [[from p = data order by p.lastModified]]
assert_equal(#r, 2)
assert_equal(r[1].name, "John")
assert_equal(r[1].lastModified, 1)
assert_equal(r[2].name, "Jane")
assert_equal(r[2].lastModified, 2)

-- Select specific fields
local r = query [[from p = data order by p.age select {name=p.name, age=p.age}]]
assert_equal(#r, 2)
assert_equal(r[1].name, "John")
assert_equal(r[1].age, 20)
assert_equal(r[2].name, "Jane")
assert_equal(r[2].age, 21)
assert_equal(r[1].lastModified, nil)
assert_equal(r[2].lastModified, nil)

-- Array transformation
local r = query [[from {1, 2, 3} select _ + 1]]
assert_equal(#r, 3)
assert_equal(r[1], 2)
assert_equal(r[2], 3)
assert_equal(r[3], 4) 