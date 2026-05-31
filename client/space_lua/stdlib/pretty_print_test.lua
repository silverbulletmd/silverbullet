local function assertEquals(actual, expected, message)
  if actual ~= expected then
    error('Assertion failed: ' .. message .. ' (got: ' .. tostring(actual) .. ')')
  end
end

-- expression printing
local expr = spacelua.parseExpression("1+2")
assertEquals(spacelua.prettyPrintExpression(expr), "1 + 2", "prettyPrintExpression 1+2")

-- block printing (round-trip through parse)
local block = spacelua.parseBlock("local x=1\nlocal y=2")
assertEquals(spacelua.prettyPrintBlock(block), "local x = 1\nlocal y = 2", "prettyPrintBlock locals")

-- options: indent width
local block2 = spacelua.parseBlock("if a then return 1 end")
assertEquals(
  spacelua.prettyPrintBlock(block2, { indentWidth = 4 }),
  "if a then\n    return 1\nend",
  "prettyPrintBlock indentWidth=4"
)

-- options: single quotes
local s = spacelua.parseExpression('"hi"')
assertEquals(spacelua.prettyPrintExpression(s, { quote = "single" }), "'hi'", "single quotes")
