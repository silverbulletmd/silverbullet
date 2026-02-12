local function assertEquals(a, b)
    if a ~= b then
        error("Assertion failed: " .. a .. " is not equal to " .. b)
    end
end

-- Test query functionality
local data = { { name = "John", lastModified = 1, age = 20 }, { name = "Jane", lastModified = 2, age = 21 } }

-- Basic limit query
local r = query [[from p = data limit 1]]
assertEquals(#r, 1)
assertEquals(r[1].name, "John")
assertEquals(r[1].lastModified, 1)

-- Order by descending
local r = query [[from p = data order by p.lastModified desc]]
assertEquals(#r, 2)
assertEquals(r[1].name, "Jane")
assertEquals(r[1].lastModified, 2)
assertEquals(r[2].name, "John")
assertEquals(r[2].lastModified, 1)

-- Order by ascending
local r = query [[from p = data order by p.lastModified]]
assertEquals(#r, 2)
assertEquals(r[1].name, "John")
assertEquals(r[1].lastModified, 1)
assertEquals(r[2].name, "Jane")
assertEquals(r[2].lastModified, 2)

-- Select specific fields
local r = query [[from p = data order by p.age select {name=p.name, age=p.age}]]
assertEquals(#r, 2)
assertEquals(r[1].name, "John")
assertEquals(r[1].age, 20)
assertEquals(r[2].name, "Jane")
assertEquals(r[2].age, 21)
assertEquals(r[1].lastModified, nil)
assertEquals(r[2].lastModified, nil)

-- Array transformation
local r = query [[from {1, 2, 3} select _ + 1]]
assertEquals(#r, 3)
assertEquals(r[1], 2)
assertEquals(r[2], 3)
assertEquals(r[3], 4) 