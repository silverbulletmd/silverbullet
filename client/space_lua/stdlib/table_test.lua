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

-- nil and NaN keys are forbidden on write
do
    -- nil key at assignment
    assertError(function()
        local t = {}
        t[nil] = "foo"
    end)

    -- nil key in table constructor (dynamic field)
    assertError(function()
        local k = nil
        local _ = { [k] = "foo" }
    end)

    -- NaN key at assignment
    assertError(function()
        local t = {}
        t[0/0] = "bar"
    end)

    -- NaN key in table constructor
    assertError(function()
        local _ = { [0/0] = "bar" }
    end)

    -- reading with nil key returns nil silently
    local t = {}
    assertEqual(t[nil], nil)
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

    table.sort(t, function(a, b) return a < b end)
    assertEqual(t, { 1, 2, 3 })

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

-- table.move
do
    -- Basic copy within same table (non-overlapping)
    local t = { 1, 2, 3, 4, 5 }
    table.move(t, 1, 3, 4)
    assertEqual(t[4], 1)
    assertEqual(t[5], 2)
    assertEqual(t[6], 3)
    -- original slots untouched
    assertEqual(t[1], 1)
    assertEqual(t[2], 2)
    assertEqual(t[3], 3)

    -- Same, with nested table values
    local nt = { {a=1}, {a=2}, {a=3}, "x", "x" }
    table.move(nt, 1, 3, 4)
    assertEqual(nt[4].a, 1)
    assertEqual(nt[5].a, 2)
    assertEqual(nt[6].a, 3)
    assertTrue(nt[4] == nt[1])

    -- Optional destination defaults to source
    local a = { 10, 20, 30 }
    local ret = table.move(a, 1, 2, 4)
    assertTrue(ret == a)
    assertEqual(a[4], 10)
    assertEqual(a[5], 20)

    -- Same with nested values
    local na = { {v=10}, {v=20}, {v=30} }
    local nret = table.move(na, 1, 2, 4)
    assertTrue(nret == na)
    assertEqual(na[4].v, 10)
    assertEqual(na[5].v, 20)

    -- Copy to a different table; returns destination, source unchanged
    local src = { "a", "b", "c" }
    local dst = { "x", "y", "z", "w" }
    local ret2 = table.move(src, 1, 3, 2, dst)
    assertTrue(ret2 == dst)
    assertEqual(dst[1], "x") -- before destination start: untouched
    assertEqual(dst[2], "a")
    assertEqual(dst[3], "b")
    assertEqual(dst[4], "c")
    assertEqual(src[1], "a") -- source untouched
    assertEqual(src[2], "b")
    assertEqual(src[3], "c")

    -- Same with nested values in source and destination
    local nsrc = { {k=1}, {k=2}, {k=3} }
    local ndst = { {k=99}, {k=99}, {k=99}, {k=99} }
    local nret2 = table.move(nsrc, 1, 3, 2, ndst)
    assertTrue(nret2 == ndst)
    assertEqual(ndst[1].k, 99) -- before destination start: untouched
    assertEqual(ndst[2].k, 1)
    assertEqual(ndst[3].k, 2)
    assertEqual(ndst[4].k, 3)
    assertTrue(ndst[2] == nsrc[1]) -- shallow copy: same object
    assertEqual(nsrc[1].k, 1) -- source untouched

    -- Overlapping: same table — requires backward copy to be correct
    local ov = { 1, 2, 3, 4, 5 }
    table.move(ov, 1, 4, 2)
    assertEqual(ov[1], 1) -- slot before destination: untouched
    assertEqual(ov[2], 1)
    assertEqual(ov[3], 2)
    assertEqual(ov[4], 3)
    assertEqual(ov[5], 4)

    -- Same with nested values — backward copy must not clobber via aliasing
    local nov = { {n=1}, {n=2}, {n=3}, {n=4}, {n=5} }
    table.move(nov, 1, 4, 2)
    assertEqual(nov[2].n, 1)
    assertEqual(nov[3].n, 2)
    assertEqual(nov[4].n, 3)
    assertEqual(nov[5].n, 4)
    assertTrue(nov[2] == nov[1]) -- same object references after shift

    -- Overlapping: same table — forward copy is safe (shift left)
    local ov2 = { 1, 2, 3, 4, 5 }
    table.move(ov2, 2, 5, 1)
    assertEqual(ov2[1], 2)
    assertEqual(ov2[2], 3)
    assertEqual(ov2[3], 4)
    assertEqual(ov2[4], 5)

    -- Same with nested values
    local nov2 = { {n=1}, {n=2}, {n=3}, {n=4}, {n=5} }
    table.move(nov2, 2, 5, 1)
    assertEqual(nov2[1].n, 2)
    assertEqual(nov2[2].n, 3)
    assertEqual(nov2[3].n, 4)
    assertEqual(nov2[4].n, 5)

    -- Exact same position: same table) — forward copy, net no-op
    local same = { 7, 8, 9 }
    table.move(same, 1, 3, 1)
    assertEqual(same[1], 7)
    assertEqual(same[2], 8)
    assertEqual(same[3], 9)

    -- Empty range: no writes, returns destination
    local empty = { 1, 2, 3 }
    local ret3 = table.move(empty, 3, 1, 1)
    assertTrue(ret3 == empty)
    assertEqual(empty[1], 1)
    assertEqual(empty[2], 2)
    assertEqual(empty[3], 3)

    -- Empty range with explicit different destination
    local esrc = { 1, 2 }
    local edst = { 9, 9 }
    local ret4 = table.move(esrc, 2, 1, 1, edst)
    assertTrue(ret4 == edst)
    assertEqual(edst[1], 9)
    assertEqual(edst[2], 9)

    -- Single element copy
    local s = { 10, 20, 30 }
    table.move(s, 2, 2, 3)
    assertEqual(s[3], 20)

    -- Single element copy, nested
    local ns = { {x=1}, {x=2}, {x=3} }
    table.move(ns, 2, 2, 3)
    assertTrue(ns[3] == ns[2])
    assertEqual(ns[3].x, 2)
end
