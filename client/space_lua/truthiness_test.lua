local function assertEquals(actual, expected, msg)
  if actual ~= expected then
    error('assertEquals failed: ' .. msg)
  end
end

local function assertTrue(cond, msg)
  if not cond then
    error('assertTrue failed: ' .. msg)
  end
end

local function assertFalse(cond, msg)
  if cond then
    error('assertFalse failed: ' .. msg)
  end
end

-- Helpers for multi-return tests

local function ret_nil_one()
  return nil, 1
end

local function ret_false_one()
  return false, 1
end

local function ret_zero_one()
  return 0, 1
end

local function ret_emptystr_one()
  return "", 1
end

local function ret_tbl_one()
  return {}, 1
end

local function ret_one_two()
  return 1, 2
end

-- 1. Basic boolean/nil

assertFalse(false, "false must be falsey")
assertTrue(true, "true must be truthy")
assertFalse(nil, "nil must be falsey")

-- 2. Numbers: all numbers are truthy

assertTrue(0, "0 must be truthy")
assertTrue(1, "1 must be truthy")
assertTrue(-1, "-1 must be truthy")
assertTrue(0.0, "0.0 must be truthy")
assertTrue(-0.0, "-0.0 must be truthy")

-- 3. Strings: empty and non-empty strings are truthy

assertTrue("", "empty string must be truthy")
assertTrue("0", '"0" must be truthy')
assertTrue("a", '"a" must be truthy')

-- 4. Tables: empty and non-empty tables are truthy

assertTrue({}, "empty table must be truthy")
assertTrue({1}, "non-empty table must be truthy")

-- 5. Functions are truthy

local fn = function() end

assertTrue(fn, "function must be truthy")
assertTrue(function() end, "function must be truthy")

-- 6. Multi-return: only the first value determines truthiness

if ret_nil_one() then
  error("ret_nil_one() must be falsey (first result nil)")
end

if ret_false_one() then
  error("ret_false_one() must be falsey (first result false)")
end

if not ret_zero_one() then
  error("ret_zero_one() must be truthy (first result 0)")
end

if not ret_emptystr_one() then
  error("ret_emptystr_one() must be truthy (first result empty string)")
end

if not ret_tbl_one() then
  error("ret_tbl_one() must be truthy (first result table)")
end

-- 7. `and`/`or` short-circuiting and value returns

-- 7.1. `and` returns first falsey value, otherwise last value

assertEquals((true and 2), 2, "and: true and 2 -> 2")
assertEquals((false and 2), false, "and: false and 2 -> false")
assertEquals((nil and 2), nil, "and: nil and 2 -> nil")
assertEquals((0 and "x"), "x", "and: 0 and 'x' -> 'x' (0 is truthy)")

-- 7.2. `or` returns first truthy value, otherwise last value

assertEquals((false or 3), 3, "or: false or 3 -> 3")
assertEquals((nil or 3), 3, "or: nil or 3 -> 3")
assertEquals((0 or 3), 0, "or: 0 or 3 -> 0 (0 is truthy)")
assertEquals(("" or "x"), "", "or: '' or 'x' -> '' ('' is truthy)")

-- 7.3. Multi-return: operand evaluation yields first value

assertEquals((true and ret_one_two()), 1,
  "and: true and (1,2) yields first result 1")

assertEquals((false or ret_one_two()), 1,
  "or: false or (1,2) yields first result 1")

-- 8. Litmus tests involving tables and `and`/`or`

-- {} and 2 or 3 -> 2
-- {} or 2 and 3 -> {} (because {} is truthy, or returns left operand)

local t = {}

assertEquals((t and 2 or 3), 2, "{} and 2 or 3 must be 2")

-- `v` should be the same table reference `t`

local v = (t or 2 and 3)

assertTrue(type(v) == "table",
  "{} or 2 and 3 must return the table (truthy left operand)")

-- changing `t` reflects in `v` (same reference)

t.key = "ok"

assertEquals(v.key, "ok",
  "{} or 2 and 3 returns original table reference")

-- 9. `if`/`while` with truthiness

local ran_if_truthy = false

if {} then
  ran_if_truthy = true
end

assertTrue(ran_if_truthy, "if {} must run branch")

local ran_if_falsey = false

if nil then
  ran_if_falsey = true
end

assertFalse(ran_if_falsey, "if nil must not run branch")

-- `while` must stop only on `false`/`nil`

local n = 0

local function next_or_nil()
  n = n + 1

  if n <= 2 then
    return 0
    -- 0 truthy -> loop two times
  end

  return nil -- stop
end

local count = 0

while next_or_nil() do
  count = count + 1
end

assertEquals(count, 2,
  "while should loop while condition is truthy")

-- 10. Short-circuit evaluation (no RHS evaluation when not needed)

local side = 0

local function bump()
  side = side + 1
  return true
end

-- For `true or bump()` RHS must not be evaluated

local s0 = side
local _ = (true or bump())

assertEquals(side, s0, "or short-circuit must avoid RHS when LHS truthy")

-- For `false and bump()` RHS must not be evaluated

local _ = (false and bump())

assertEquals(side, s0, "and short-circuit must avoid RHS when LHS falsey")

-- 11. Multi-return short-circuit

local function falsy_pair()
  return nil, "x"
end

local function truthy_pair()
  return 1, "x"
end

-- `or`: pick RHS only when LHS falsey (first result)

local s1 = (falsy_pair() or 5)

assertEquals(s1, 5, "or should see falsy first result and evaluate RHS")

local s2 = (truthy_pair() or 5)

assertEquals(s2, 1, "or should return first result of LHS when truthy")

-- 12. Only the last expression expands

local function ret() return "A", "B" end
local function a() return "A1", "A2" end
local function b() return "B1", "B2" end
local function c() return "C1", "C2" end

assertEquals(string.format("%s-%s", ret()), "A-B",
  "last-only: single arg expands")

assertEquals(string.format("%s-%s", ret(), "Z"), "A-Z",
  "last-only: earlier arg is single")

assertEquals(string.format("%s-%s-%s-%s", a(), b(), c()), "A1-B1-C1-C2",
  "last-only: only last expands, earlier args single")

-- 13. Only false and `nil` are falsey

assertFalse(not 0, "not 0 must be false")
assertFalse(not -0.0, "not -0.0 must be false")
assertFalse(not "", "not '' must be false")
assertFalse(not {}, "not {} must be false")

assertTrue(not nil, "not nil must be true")
assertTrue(not false, "not false must be true")
