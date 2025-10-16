local function assert_eq(actual, expected, msg)
  if actual ~= expected then
    error('assert_eq failed: ' .. msg)
  end
end

local function assert_throws(substr, fn)
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

-- 3. Non-strings/non-tables (must error)
assert_throws(
  "attempt to get length of a nil value",
  function()
    return #nil
  end
)

assert_throws(
  "attempt to get length of a number value",
  function()
    return #1
  end
)

assert_throws(
  "attempt to get length of a boolean value",
  function()
    return #false
  end
)

assert_throws(
  "attempt to get length of a function value",
  function()
    local f = function() end
    return #f
  end
)
