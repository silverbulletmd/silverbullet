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

-- 1. Successful compile -> returns function; call yields value

do
  local f, err = load("return 40 + 2")

  assertEquals(type(f), "function", "load must return function on success")
  assertEquals(err, nil, "load must not return error on success")
  assertEquals(f(), 42, "loaded chunk executes and returns")
end

-- 2. No explicit return -> nil on call

do
  local f, err = load("local x = 1; x = x + 1")

  assertEquals(type(f), "function", "load returns function even without returns")
  assertEquals(err, nil, "no error expected")
  assertEquals(f(), nil, "chunk without return yields nil")
end

-- 3. Syntax error -> (nil, "error message"), no throw on load

do
  local f, err = load("return 1 +")

  assertEquals(f, nil, "syntax error: first result is nil")
  assertEquals(type(err), "string", "syntax error: second result is error string")
end

-- 4. Runtime error when calling the returned function

do
  local f = load("return 1 + {}") -- arithmetic on non-number at runtime
  local ok, res = pcall(f)

  assertFalse(ok, "pcall must be false on runtime error")
  assertEquals(type(res), "string", "pcall error message is string")
end

-- 5. Global reads are visible in loaded chunk

do
  g = 41
  local f = load("return g + 1")

  assertEquals(f(), 42, "loaded chunk sees global env (read)")
end

-- 6. Global writes from loaded chunk update globals
do
  h = 0
  local f = load("h = 9")

  assertEquals(f(), nil, "no explicit return")
  assertEquals(h, 9, "global updated by loaded chunk (write)")
end
