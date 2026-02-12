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
  assertEquals(i, 3, "modf(3.5) int")
  assertClose(f, 0.5, 1e-12, "modf(3.5) frac")

  local i2, f2 = math.modf(-3.5)
  assertEquals(i2, -3, "modf(-3.5) int")
  assertClose(f2, -0.5, 1e-12, "modf(-3.5) frac")
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
