local parsedExpr = spacelua.parseExpression("1 + 1")
local evalResult = spacelua.evalExpression(parsedExpr)
assert(evalResult == 2, "Eval should return 2")

-- Slightly more advanced example with augmented environment
local parsedExpr = spacelua.parseExpression("tostring(a + 1)")
local evalResult = spacelua.evalExpression(parsedExpr, { a = 1 })
assert(evalResult == "2", "Eval should return 2 as a string")
