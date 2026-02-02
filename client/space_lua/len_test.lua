local function assert_eq(actual, expected, msg)
  if actual ~= expected then
    error('assert_eq failed: ' .. msg)
  end
end

local function assertThrows(substr, fn)
  local ok, err = pcall(fn)
  if ok then
    error("expected error containing: " .. substr)
  end

  err = tostring(err)
  if not string.find(err, substr, 1, true) then
    error("error message mismatch: got: " .. err)
  end
end

-- 1. Strings: raw length, ignore metamethods
assert_eq(#"", 0, "empty string length")
assert_eq(#"abc", 3, "string length")

-- 2. Tables (raw length for sequence or `__len`)
assert_eq(#{}, 0, "empty table length")
assert_eq(#{1,2,3}, 3, "array length")

do
  local t = {}

  setmetatable(t,
  {
    __len = function(_)
      return 42
    end,
  })

  assert_eq(#t, 42, "__len should override raw table length")
end

-- 2.1. Metamethod result handling
do
  local t = {}

  setmetatable(t,
  {
    __len = function(_)
      return 42, 1, 2, 3
    end,
  })

  assert_eq(#t, 42, "__len must use only first return value")
end

-- 2.2. Raw length when no array part
do
  local t = {
    a = 1,
    b = 2,
  }

  assert_eq(#t, 0, "table with only non-integer keys has length 0")
end

-- 2.3. Length when both array and key-value parts
do
  local t = {
    a = 1,
    b = 2,
    1,
    2,
    c = 3,
    3,
  }

  assert_eq(#t, 3, "table with mixed non-integer and integer keys")
end

-- 3. Non-strings and non-tables
assertThrows(
  "attempt to get length of a nil value",
  function()
    return #nil
  end
)

assertThrows(
  "attempt to get length of a number value",
  function()
    return #1
  end
)

assertThrows(
  "attempt to get length of a boolean value",
  function()
    return #false
  end
)

assertThrows(
  "attempt to get length of a function value",
  function()
    local f = function() end
    return #f
  end
)

-- 4. rawlen() semantics
do
  local t = { 1, 2, 3 }

  setmetatable(t, {
    __len = function(_) return 99 end,
  })

  assert_eq(#t, 99, "#t uses __len")
  assert_eq(rawlen(t), 3, "rawlen(t) ignores __len")
end

-- 5. Trailing-nil shrinking behavior
do
  local t = { 1, 2, 3 }
  assert_eq(#t, 3, "initial sequence length")

  t[3] = nil
  assert_eq(#t, 2, "sequence length shrinks when last element is set to nil")
  assert_eq(rawlen(t), 2, "rawlen shrinks with trailing nil (array part shrinks)")

  t[2] = nil
  assert_eq(#t, 1, "sequence length shrinks again after removing new last element")
  assert_eq(rawlen(t), 1, "rawlen shrinks again after trailing nil")
end

-- 6. rawlen on strings
assert_eq(rawlen("abc"), 3, "rawlen on strings")

-- 7. rawlen(t) must ignore the __len metamethod
local t = {1,2,3}

setmetatable(t, {
  __len = function()
    return 99 end
})

assert(#t == 99)
assert(rawlen(t) == 3)
