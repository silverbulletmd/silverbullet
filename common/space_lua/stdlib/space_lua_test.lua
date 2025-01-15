local function assert_equal(a, b)
    if a ~= b then
        error("Assertion failed: " .. a .. " is not equal to " .. b)
    end
end

-- Test space_lua stuff
local parsedExpr = space_lua.parse_expression("1 + 1")
local evalResult = space_lua.eval_expression(parsedExpr)
assert(evalResult == 2, "Eval should return 2")

-- Slightly more advanced example with augmented environment
local parsedExpr = space_lua.parse_expression("tostring(a + 1)")
local evalResult = space_lua.eval_expression(parsedExpr, { a = 1 })
assert(evalResult == "2", "Eval should return 2 as a string") 