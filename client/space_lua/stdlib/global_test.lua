local function assertEqual(a, b)
    if a ~= b then
        error("Assertion failed: " .. a .. " is not equal to " .. b)
    end
end

-- Logic values, shouldn't be affected
assertEqual(some(nil), nil)
assertEqual(some(true), true)
assertEqual(some(false), false)

-- Numbers
assertEqual(some(1), 1)
assertEqual(some(0), 0) -- 0 is not falsy unlike C
assertEqual(some(-1), -1)
assertEqual(some(1/0), nil) -- inf
assertEqual(some(0/0), nil) -- nan

-- Strings
assertEqual(some("foo bar"), "foo bar")
assertEqual(some(""), nil)
assertEqual(some(" \n"), nil)

-- Tables
assertEqual(some({}), nil)
assertEqual(some({"baz"})[1], "baz") -- compare an element to ensure passthrough
assertEqual(some({foo="bar"})["foo"], "bar")

-- tostring: primitives
assertEqual(tostring(nil), "nil")
assertEqual(tostring(true), "true")
assertEqual(tostring(false), "false")
assertEqual(tostring(42), "42")
assertEqual(tostring(3.14), "3.14")

-- tostring: `__tostring` metamethod is called with the live SF
local mt = { __tostring = function(t) return "custom:" .. t.name end }
local obj = setmetatable({ name = "lua" }, mt)
assertEqual(tostring(obj), "custom:lua")

-- tostring: `__tostring` returning non-string must error
local bad_mt = { __tostring = function(_) return 99 end }
local bad_obj = setmetatable({}, bad_mt)
local ok, err = pcall(tostring, bad_obj)
assertEqual(ok, false)

-- tostring: `__tostring` on a nested call (SF propagation via `luaCall`)
local inner_mt = {
    __tostring = function(t)
        return "inner:" .. tostring(t.val)
    end
}
local inner = setmetatable({ val = 7 }, inner_mt)
assertEqual(tostring(inner), "inner:7")
