local function assert_equal(a, b)
    if a ~= b then
        error("Assertion failed: " .. a .. " is not equal to " .. b)
    end
end

-- Basic OS functions
assert(os.time() > 0)
assert(os.date("%Y-%m-%d", os.time({ year = 2020, month = 1, day = 1 })) == "2020-01-01")

-- Week calculations
assert(os.date("%U %V %W", os.time({ year = 2051, month = 1, day = 1 })) == "01 52 00")

local t = os.time()
assert(os.difftime(t+10, t) == 10)
assert(os.difftime(t, t+10) == -10)
assert(os.difftime(t, t) == 0)
assert(os.date("%U %V %W", os.time({ year = 2024, month = 1, day = 7 })) == "01 01 01")
assert(os.date("%U %V %W", os.time({ year = 2025, month = 1, day = 5 })) == "01 01 00")
assert(os.date("%U %V %W", os.time({ year = 2025, month = 1, day = 6 })) == "01 02 01")
assert(os.date("%U %V %W", os.time({ year = 2025, month = 1, day = 7 })) == "01 02 01")
assert(os.date("%U %V %W", os.time({ year = 2025, month = 5, day = 3 })) == "17 18 17")

assert(os.date("%w", 1750672800) == "1")
