local function assertEquals(a, b, msg)
  if a ~= b then
    error((msg or "assertEquals failed") .. ": expected " .. tostring(b) .. " got " .. tostring(a))
  end
end

local function assertTrue(v, msg)
  if not v then
    error(msg or "assertTrue failed")
  end
end

local function assertClose(a, b, eps, msg)
  eps = eps or 1e-12
  if a ~= a and b ~= b then
    return
  end
  if a == b then
    return
  end
  local d = a - b
  if d < 0 then d = -d end
  if d > eps then
    error((msg or "assertClose failed") .. ": expected " .. tostring(b) .. " got " .. tostring(a))
  end
end

local function assertError(fn, msg)
  local ok, err = pcall(fn)
  if ok then
    error((msg or "assertError failed") .. ": expected an error but none was raised")
  end
end

-- math.type (basic)
do
  assertEquals(math.type(0), "integer", "math.type(0)")
  assertEquals(math.type(1), "integer", "math.type(1)")
  assertEquals(math.type(0.0), "float", "math.type(0.0)")
  assertEquals(math.type(-0.0), "float", "math.type(-0.0)")
  assertEquals(math.type(1.5), "float", "math.type(1.5)")
end

-- constants
do
  assertTrue(type(math.pi) == "number", "math.pi exists")
  assertTrue(type(math.huge) == "number", "math.huge exists")
end

-- abs
do
  assertEquals(math.abs(-5), 5, "abs(-5)")
  assertEquals(math.abs(-3), 3, "abs(-3)")
  assertEquals(math.abs(3), 3, "abs(3)")
  assertClose(math.abs(-3.25), 3.25, 1e-12, "abs(-3.25)")
end

-- floor/ceil (rounding correctness)
do
  assertEquals(math.floor(3.7), 3, "floor(3.7)")
  assertEquals(math.floor(3), 3, "floor(3)")
  assertEquals(math.floor(3.0), 3, "floor(3.0)")
  assertEquals(math.floor(3.1), 3, "floor(3.1)")
  assertEquals(math.floor(3.9), 3, "floor(3.9)")
  assertEquals(math.floor(-3.1), -4, "floor(-3.1)")
  assertEquals(math.floor(-3.9), -4, "floor(-3.9)")

  assertEquals(math.ceil(3.3), 4, "ceil(3.3)")
  assertEquals(math.ceil(3), 3, "ceil(3)")
  assertEquals(math.ceil(3.0), 3, "ceil(3.0)")
  assertEquals(math.ceil(3.1), 4, "ceil(3.1)")
  assertEquals(math.ceil(3.9), 4, "ceil(3.9)")
  assertEquals(math.ceil(-3.1), -3, "ceil(-3.1)")
  assertEquals(math.ceil(-3.9), -3, "ceil(-3.9)")
end

-- min/max
do
  assertEquals(math.max(1, 2, 3, 4), 4, "max(1,2,3,4)")
  assertEquals(math.min(1, 2, 3, 4), 1, "min(1,2,3,4)")

  assertEquals(math.max(1, 2, 3), 3, "max")
  assertEquals(math.min(1, 2, 3), 1, "min")
  assertEquals(math.max(-1, -2), -1, "max negative")
  assertEquals(math.min(-1, -2), -2, "min negative")
end

-- modf
do
  local i, f = math.modf(3.5)
  assertEquals(math.type(i), "integer", "modf int part is integer")
  assertEquals(math.type(f), "float",   "modf frac part is float")
  assertEquals(i, 3, "modf(3.5) int")
  assertClose(f, 0.5, 1e-12, "modf(3.5) frac")

  local i2, f2 = math.modf(-3.5)
  assertEquals(math.type(i2), "integer", "modf neg int part is integer")
  assertEquals(math.type(f2), "float",   "modf neg frac part is float")
  assertEquals(i2, -3, "modf(-3.5) int")
  assertClose(f2, -0.5, 1e-12, "modf(-3.5) frac")

  local i3, f3 = math.modf(4.0)
  assertEquals(math.type(i3), "integer", "modf whole int part is integer")
  assertEquals(math.type(f3), "float", "modf whole frac is float")
  assertEquals(i3, 4, "modf(4.0) int")
  assertEquals(f3, 0.0, "modf(4.0) frac")
end

-- sqrt/exp/log/pow
do
  assertEquals(math.exp(0), 1, "exp(0)")
  assertClose(math.log(math.exp(1)), 1, 1e-12, "log(exp(1))")
  assertClose(math.log(8, 2), 3, 1e-12, "log base 2 of 8")
  assertEquals(math.pow(2, 3), 8, "pow(2,3)")
  assertEquals(math.sqrt(9), 3, "sqrt(9)")
end

-- trigonomic
do
  assertEquals(math.cos(0), 1, "cos(0)")
  assertEquals(math.sin(0), 0, "sin(0)")
  assertEquals(math.tan(0), 0, "tan(0)")
  assertEquals(math.acos(1), 0, "acos(1)")
  assertEquals(math.asin(0), 0, "asin(0)")
  assertEquals(math.atan(0), 0, "atan(0)")
  assertEquals(math.atan(0, 1), 0, "atan(0,1)")
end

-- hyperbolic
do
  assertEquals(math.cosh(0), 1, "cosh(0)")
  assertEquals(math.sinh(0), 0, "sinh(0)")
  assertEquals(math.tanh(0), 0, "tanh(0)")
end

-- remainder
do
  assertEquals(math.fmod(7, 3), 1, "fmod(7,3)")
end

-- random
do
  local a1 = math.random()
  assertTrue(a1 >= 0 and a1 < 1, "random() range")

  local aN = math.random(10)
  assertTrue(aN >= 1 and aN <= 10, "random(10) range")

  local aR = math.random(5, 10)
  assertTrue(aR >= 5 and aR <= 10, "random(5,10) range")
end

-- unsigned less-than
do
  assertEquals(math.ult(1, 2), true, "ult(1,2)")
  assertEquals(math.ult(2, 1), false, "ult(2,1)")
end

-- reported regression
do
  local x1 = 8 * 0.5
  local x2 = 8 * 0.49
  local x3 = 9 * 0.5

  assertClose(x1, 4.0, 0, "8*0.5 == 4.0")
  assertClose(x2, 3.92, 1e-12, "8*0.49 == 3.92")
  assertClose(x3, 4.5, 1e-12, "9*0.5 == 4.5")

  local f1 = math.floor(x1)
  local f2 = math.floor(x2)
  local f3 = math.floor(x3)

  assertTrue(f1 == f1, "floor(8*0.5) not NaN")
  assertTrue(f2 == f2, "floor(8*0.49) not NaN")
  assertTrue(f3 == f3, "floor(9*0.5) not NaN")

  assertEquals(f1, 4, "floor(8*0.5)")
  assertEquals(f2, 3, "floor(8*0.49)")
  assertEquals(f3, 4, "floor(9*0.5)")
end

-- math.tointeger
do
  -- integers pass through unchanged
  assertEquals(math.tointeger(0),  0,  "tointeger(0)")
  assertEquals(math.tointeger(42), 42, "tointeger(42)")
  assertEquals(math.tointeger(-7), -7, "tointeger(-7)")
  assertEquals(math.type(math.tointeger(1)), "integer", "tointeger result is integer")

  -- float with whole value yields integer
  assertEquals(math.tointeger(3.0),  3,  "tointeger(3.0)")
  assertEquals(math.tointeger(-1.0), -1, "tointeger(-1.0)")
  assertEquals(math.type(math.tointeger(3.0)), "integer", "tointeger(3.0) type")

  -- float with fractional part yields nil
  assertEquals(math.tointeger(3.5),  nil, "tointeger(3.5)")
  assertEquals(math.tointeger(-0.1), nil, "tointeger(-0.1)")

  -- string coercion: integer-valued string yields integer
  assertEquals(math.tointeger("3"),  3,   "tointeger(string int)")
  assertEquals(math.tointeger("3.0"), 3,  "tointeger(string float whole)")
  assertEquals(math.tointeger("3.5"), nil, "tointeger(string float frac)")
  assertEquals(math.tointeger("x"),   nil, "tointeger(non-numeric string)")

  -- nil yields nil
  assertEquals(math.tointeger(nil),  nil, "tointeger(nil)")

  -- inf and nan yields nil
  assertEquals(math.tointeger(1/0),  nil, "tointeger(inf)")
  assertEquals(math.tointeger(0/0),  nil, "tointeger(nan)")
end

-- random and randomseed
do
  -- random(): float in [0, 1)
  for _ = 1, 20 do
    local v = math.random()
    assertTrue(v >= 0 and v < 1, "random() in [0,1)")
    assertEquals(math.type(v), "float", "random() returns float")
  end

  -- random(n): integer in [1, n]
  for _ = 1, 20 do
    local v = math.random(10)
    assertTrue(v >= 1 and v <= 10, "random(10) in [1,10]")
    assertEquals(math.type(v), "integer", "random(n) returns integer")
  end

  -- random(m, n): integer in [m, n]
  for _ = 1, 20 do
    local v = math.random(5, 10)
    assertTrue(v >= 5 and v <= 10, "random(5,10) in [5,10]")
    assertEquals(math.type(v), "integer", "random(m,n) returns integer")
  end

  -- random(m, m): always returns m
  for _ = 1, 5 do
    assertEquals(math.random(7, 7), 7, "random(m,m) == m")
  end

  -- random(0): raw 64-bit integer, type integer
  local r0 = math.random(0)
  assertEquals(math.type(r0), "integer", "random(0) returns integer")

  -- random(n) with n=1: always 1
  for _ = 1, 5 do
    assertEquals(math.random(1), 1, "random(1) == 1")
  end

  -- error: random(0.5) — non-integer arg1
  assertError(function() math.random(0.5) end)

  -- error: random(1, 0) — empty interval
  assertError(function() math.random(1, 0) end)

  -- error: random(0) is valid (raw), but random(-1) is not
  assertError(function() math.random(-1) end)

  -- error: random(1, 1.5) — non-integer arg2
  assertError(function() math.random(1, 1.5) end)

  -- randomseed arg validation
  assertError(function() math.randomseed(0.5) end)
  assertError(function() math.randomseed(1, 0.5) end)
  assertError(function() math.randomseed(1/0) end)
end

-- randomseed: determinism
do
  -- same seed yields identical sequence
  math.randomseed(42)
  local a1, a2, a3 = math.random(), math.random(100), math.random(1, 50)

  math.randomseed(42)
  local b1, b2, b3 = math.random(), math.random(100), math.random(1, 50)

  assertEquals(a1, b1, "randomseed: float sequence reproducible")
  assertEquals(a2, b2, "randomseed: random(n) reproducible")
  assertEquals(a3, b3, "randomseed: random(m,n) reproducible")

  -- different seeds yields different first values
  math.randomseed(1)
  local c1 = math.random()
  math.randomseed(2)
  local d1 = math.random()
  assertTrue(c1 ~= d1, "different seeds give different values")

  -- two-argument seed: same pair yields same sequence
  math.randomseed(123, 456)
  local e1, e2 = math.random(), math.random()
  math.randomseed(123, 456)
  local f1, f2 = math.random(), math.random()
  assertEquals(e1, f1, "randomseed(x,y): first value reproducible")
  assertEquals(e2, f2, "randomseed(x,y): second value reproducible")

  -- two-argument seed: different second arg yields different sequence
  math.randomseed(123, 456)
  local g1 = math.random()
  math.randomseed(123, 789)
  local h1 = math.random()
  assertTrue(g1 ~= h1, "randomseed(x,y1) ~= randomseed(x,y2)")

  -- no-args seed does not error and produces valid range
  math.randomseed()
  local i1 = math.random()
  assertTrue(i1 >= 0 and i1 < 1, "randomseed(): range valid after auto-seed")

  -- return values: two integers (Lua 5.4 contract)
  local s1, s2 = math.randomseed(99)
  assertEquals(math.type(s1), "integer", "randomseed returns integer s1")
  assertEquals(math.type(s2), "integer", "randomseed returns integer s2")

  -- re-seeding restores determinism after auto-seed
  math.randomseed(7)
  local j1 = math.random()
  math.randomseed(7)
  local j2 = math.random()
  assertEquals(j1, j2, "determinism restored after re-seed")
end
