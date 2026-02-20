local function deepCompare(t1, t2, seen)
    if t1 == t2 then return true end
    if type(t1) ~= "table" or type(t2) ~= "table" then return false end

    seen = seen or {}
    if seen[t1] and seen[t1] == t2 then return true end
    seen[t1] = t2

    local n1, n2 = 0, 0
    for _ in pairs(t1) do n1 = n1 + 1 end
    for _ in pairs(t2) do n2 = n2 + 1 end
    if n1 ~= n2 then return false end

    for k, v in pairs(t1) do
        if not deepCompare(v, t2[k], seen) then
            return false
        end
    end
    return true
end

local function assertEqual(a, b)
    if not deepCompare(a, b) then
        error("Assertion failed: " .. tostring(a) .. " is not equal to " .. tostring(b))
    end
end

local function assertTrue(v, msg)
    if not v then error(msg or "Assertion failed") end
end

local function assertFalse(v, msg)
    if v then error(msg or "Assertion failed (expected false)") end
end

local function assertError(fn, msg)
    local ok, err = pcall(fn)
    if ok then
        error(msg or "Assertion failed (expected error)")
    end
    return err
end

-- Basic table operations (insert/remove)
do
    local t = { 1, 2, 3 }
    table.insert(t, 4)
    assertEqual(t[4], 4)

    table.insert(t, 1, 99)
    assertEqual(t[1], 99)
    assertEqual(#t, 5)

    local x = table.remove(t, 1)
    assertEqual(x, 99)

    table.remove(t) -- remove last
    assertEqual(#t, 3)
    assertEqual(t, { 1, 2, 3 })

    -- remove out of range should error
    assertError(function() table.remove(t, 0) end)
    assertError(function() table.remove(t, #t + 2) end)
end

-- Reference semantics / aliasing (tables are mutable references)
do
    local a = { x = 1 }
    local b = a
    b.x = 2
    assertEqual(a.x, 2)

    local nested = { inner = { 1, 2 } }
    local alias = nested.inner
    alias[1] = 10
    assertEqual(nested.inner[1], 10)
end

-- rawget/rawset/rawequal ignore metamethods
do
    local backing = {}
    local t = setmetatable({}, {
        __index = function(_, k)
            return backing[k]
        end,
        __newindex = function(_, k, v)
            backing[k] = v
        end,
    })

    t.a = 1
    assertEqual(backing.a, 1)
    assertEqual(t.a, 1)

    rawset(t, "a", 2)
    assertEqual(rawget(t, "a"), 2)
    assertEqual(backing.a, 1)

    assertEqual(rawget(t, "missing"), nil)

    local t2 = t
    local t3 = {}
    assertTrue(rawequal(t2, t))
    assertFalse(rawequal(t3, t))
end

-- Length operator semantics
do
    local seq = { 1, 2, 3 }
    assertEqual(#seq, 3)

    local holes = { 1, 2, 3, nil, nil, nil, 4 }
    assertEqual(rawlen(holes), 7)

    local t = { 1, 2, 3 }
    t[5] = 5
    local collected = {}
    for i, v in ipairs(t) do
        collected[i] = v
    end
    assertEqual(collected, { 1, 2, 3 })
end

-- __len metamethod can override #t
do
    local t = setmetatable({ 1, 2, 3 }, {
        __len = function(_) return 123 end
    })
    assertEqual(#t, 123)
end

-- pairs / __pairs
do
    local t = setmetatable({ a = 1, b = 2 }, {
        __pairs = function(_)
            local yielded = false
            return function()
                if yielded then return nil end
                yielded = true
                return "only", 42
            end
        end
    })

    local out = {}
    for k, v in pairs(t) do
        out[k] = v
    end
    assertEqual(out, { only = 42 })
end

-- next
do
    local t = { a = 1, b = 2, c = 3 }
    local k, v = next(t, nil)
    assertTrue(k ~= nil)
    assertTrue(v ~= nil)

    local seen = {}
    while k do
        seen[k] = v
        k, v = next(t, k)
    end
    assertEqual(seen.a, 1)
    assertEqual(seen.b, 2)
    assertEqual(seen.c, 3)
end

-- table.concat
do
    assertEqual(table.concat({ "Hello", "world" }, " "), "Hello world")
    assertEqual(table.concat({ "Hello", "world", "three" }, " ", 2, 3), "world three")
    assertEqual(table.concat({ "a", "b", "c" }), "abc")
    assertEqual(table.concat({ "a", "b", "c" }, "", 2, 1), "")

    assertError(function() table.concat({ "a", {} }, "") end)
end

-- table.sort
do
    local t = { 3, 1, 2 }
    table.sort(t)
    assertEqual(t, { 1, 2, 3 })

    table.sort(t, function(a, b) return a > b end)
    assertEqual(t, { 3, 2, 1 })

    local data = { { name = "John", age = 30 }, { name = "Jane", age = 25 } }
    table.sort(data, function(a, b) return a.age < b.age end)
    assertEqual(data[1].name, "Jane")
    assertEqual(data[2].name, "John")

    assertError(function() table.sort({ 1, "x" }) end)

    -- Portable error test: comparator itself throws -> sort must raise
    assertError(function()
        table.sort({ 2, 1 }, function()
            error("boom")
        end)
    end)

    -- NOTE: Do NOT require an error for comparator returning nil; Lua may treat it as false.
end

-- table.pack / table.unpack
do
    local t = { 1, 2, 3 }
    local packed = table.pack(table.unpack(t))
    assertEqual(packed[1], 1)
    assertEqual(packed[2], 2)
    assertEqual(packed[3], 3)
    assertEqual(packed.n, 3)

    local p = table.pack(1, nil, 3, nil)
    assertEqual(p.n, 4)
    assertEqual(p[1], 1)
    assertEqual(p[2], nil)
    assertEqual(p[3], 3)
    assertEqual(p[4], nil)

    local a, b, c, d = table.unpack(p, 1, p.n)
    assertEqual(a, 1)
    assertEqual(b, nil)
    assertEqual(c, 3)
    assertEqual(d, nil)

    local seq = { "x", "y" }
    local x, y = table.unpack(seq)
    assertEqual(x, "x")
    assertEqual(y, "y")
end

-- __index / __newindex semantics
do
    local backing = { a = 10 }
    local t = setmetatable({}, {
        __index = backing,
        __newindex = function(_, k, v)
            backing[k] = v * 2
        end,
    })

    assertEqual(t.a, 10)

    t.b = 5
    assertEqual(backing.b, 10)
    assertEqual(rawget(t, "b"), nil)
end

-- Equality semantics: tables compare by reference
do
    local a = { 1 }
    local b = { 1 }
    assertFalse(a == b)
    local c = a
    assertTrue(a == c)
end

-- table.concat
do
    assertEqual(table.concat(
        { "Hello", "world" }, " "), "Hello world")
    assertEqual(table.concat(
        { "Hello", "world", "three" }, " ", 2, 3), "world three")

    assertEqual(table.concat({ "a", "b", "c" }), "abc")
    assertEqual(table.concat({ "a", "b", "c" }, "", 2, 1), "")

    assertError(function() table.concat({ "a", {} }, "") end)

    -- number coercion: integers must not get a decimal point
    assertEqual(table.concat({ 1, 2, 3 }, ","), "1,2,3")

    -- integer-valued floats must show .0 suffix (Lua semantics)
    assertEqual(table.concat({ 1.0, 2.0 }, ","), "1.0,2.0")

    -- motivating case: 10.8*22 must produce "237.6" not "237.60000000000002"
    assertEqual(table.concat({ 10.8 * 22 }, ""), "237.6")

    -- special float values
    assertEqual(table.concat({ 1/0.0 }, ""), "inf")
    assertEqual(table.concat({ -1/0.0 }, ""), "-inf")
    assertEqual(table.concat({ 0.0/0.0 }, ""), "-nan")

    -- mixed strings and numbers
    assertEqual(table.concat({ "a", 1, "b", 2.5 }, "-"), "a-1-b-2.5")
end
