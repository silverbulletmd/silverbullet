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
