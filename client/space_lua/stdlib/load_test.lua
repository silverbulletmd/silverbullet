local function assert_eq(actual, expected, msg)
  if actual ~= expected then
    error('assert_eq failed: ' .. msg)
  end
end

local function assert_true(cond, msg)
  if not cond then
    error('assert_true failed: ' .. msg)
  end
end

local function assert_false(cond, msg)
  if cond then
    error('assert_false failed: ' .. msg)
  end
end

-- 1. Successful compile -> returns function; call yields value

do
  local f, err = load("return 40 + 2")

  assert_eq(type(f), "function", "load must return function on success")
  assert_eq(err, nil, "load must not return error on success")
  assert_eq(f(), 42, "loaded chunk executes and returns")
end

-- 2. No explicit return -> nil on call

do
  local f, err = load("local x = 1; x = x + 1")

  assert_eq(type(f), "function", "load returns function even without returns")
  assert_eq(err, nil, "no error expected")
  assert_eq(f(), nil, "chunk without return yields nil")
end

-- 3. Syntax error -> (nil, "error message"), no throw on load

do
  local f, err = load("return 1 +")

  assert_eq(f, nil, "syntax error: first result is nil")
  assert_eq(type(err), "string", "syntax error: second result is error string")
end

-- 4. Runtime error when calling the returned function

do
  local f = load("return 1 + {}") -- arithmetic on non-number at runtime
  local ok, res = pcall(f)

  assert_false(ok, "pcall must be false on runtime error")
  assert_eq(type(res), "string", "pcall error message is string")
end

-- 5. Global reads are visible in loaded chunk

do
  g = 41
  local f = load("return g + 1")

  assert_eq(f(), 42, "loaded chunk sees global env (read)")
end

-- 6. Global writes from loaded chunk update globals
do
  h = 0
  local f = load("h = 9")

  assert_eq(f(), nil, "no explicit return")
  assert_eq(h, 9, "global updated by loaded chunk (write)")
end
