local function assert_eq(a, b, msg)
  if a ~= b then
    error((msg or "assert_eq failed") .. ": expected " .. tostring(b) .. " got " .. tostring(a))
  end
end

local function assert_true(v, msg)
  if not v then
    error(msg or "assert_true failed")
  end
end

local function assert_close(a, b, eps, msg)
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
    error((msg or "assert_close failed") .. ": expected " .. tostring(b) .. " got " .. tostring(a))
  end
end

-- math.type (basic)
do
  assert_eq(math.type(0), "integer", "math.type(0)")
  assert_eq(math.type(1), "integer", "math.type(1)")
  assert_eq(math.type(0.0), "float", "math.type(0.0)")
  assert_eq(math.type(-0.0), "float", "math.type(-0.0)")
  assert_eq(math.type(1.5), "float", "math.type(1.5)")
end

-- constants
do
  assert_true(type(math.pi) == "number", "math.pi exists")
  assert_true(type(math.huge) == "number", "math.huge exists")
end

-- abs
do
  assert_eq(math.abs(-5), 5, "abs(-5)")
  assert_eq(math.abs(-3), 3, "abs(-3)")
  assert_eq(math.abs(3), 3, "abs(3)")
  assert_close(math.abs(-3.25), 3.25, 1e-12, "abs(-3.25)")
end

-- floor/ceil (rounding correctness)
do
  assert_eq(math.floor(3.7), 3, "floor(3.7)")
  assert_eq(math.floor(3), 3, "floor(3)")
  assert_eq(math.floor(3.0), 3, "floor(3.0)")
  assert_eq(math.floor(3.1), 3, "floor(3.1)")
  assert_eq(math.floor(3.9), 3, "floor(3.9)")
  assert_eq(math.floor(-3.1), -4, "floor(-3.1)")
  assert_eq(math.floor(-3.9), -4, "floor(-3.9)")

  assert_eq(math.ceil(3.3), 4, "ceil(3.3)")
  assert_eq(math.ceil(3), 3, "ceil(3)")
  assert_eq(math.ceil(3.0), 3, "ceil(3.0)")
  assert_eq(math.ceil(3.1), 4, "ceil(3.1)")
  assert_eq(math.ceil(3.9), 4, "ceil(3.9)")
  assert_eq(math.ceil(-3.1), -3, "ceil(-3.1)")
  assert_eq(math.ceil(-3.9), -3, "ceil(-3.9)")
end

-- min/max
do
  assert_eq(math.max(1, 2, 3, 4), 4, "max(1,2,3,4)")
  assert_eq(math.min(1, 2, 3, 4), 1, "min(1,2,3,4)")

  assert_eq(math.max(1, 2, 3), 3, "max")
  assert_eq(math.min(1, 2, 3), 1, "min")
  assert_eq(math.max(-1, -2), -1, "max negative")
  assert_eq(math.min(-1, -2), -2, "min negative")
end

-- modf
do
  local i, f = math.modf(3.5)
  assert_eq(i, 3, "modf(3.5) int")
  assert_close(f, 0.5, 1e-12, "modf(3.5) frac")

  local i2, f2 = math.modf(-3.5)
  assert_eq(i2, -3, "modf(-3.5) int")
  assert_close(f2, -0.5, 1e-12, "modf(-3.5) frac")
end

-- sqrt/exp/log/pow
do
  assert_eq(math.exp(0), 1, "exp(0)")
  assert_close(math.log(math.exp(1)), 1, 1e-12, "log(exp(1))")
  assert_close(math.log(8, 2), 3, 1e-12, "log base 2 of 8")
  assert_eq(math.pow(2, 3), 8, "pow(2,3)")
  assert_eq(math.sqrt(9), 3, "sqrt(9)")
end

-- trigonomic
do
  assert_eq(math.cos(0), 1, "cos(0)")
  assert_eq(math.sin(0), 0, "sin(0)")
  assert_eq(math.tan(0), 0, "tan(0)")
  assert_eq(math.acos(1), 0, "acos(1)")
  assert_eq(math.asin(0), 0, "asin(0)")
  assert_eq(math.atan(0), 0, "atan(0)")
  assert_eq(math.atan(0, 1), 0, "atan(0,1)")
end

-- hyperbolic
do
  assert_eq(math.cosh(0), 1, "cosh(0)")
  assert_eq(math.sinh(0), 0, "sinh(0)")
  assert_eq(math.tanh(0), 0, "tanh(0)")
end

-- remainder
do
  assert_eq(math.fmod(7, 3), 1, "fmod(7,3)")
end

-- random
do
  local a1 = math.random()
  assert_true(a1 >= 0 and a1 < 1, "random() range")

  local aN = math.random(10)
  assert_true(aN >= 1 and aN <= 10, "random(10) range")

  local aR = math.random(5, 10)
  assert_true(aR >= 5 and aR <= 10, "random(5,10) range")
end

-- unsigned less-than
do
  assert_eq(math.ult(1, 2), true, "ult(1,2)")
  assert_eq(math.ult(2, 1), false, "ult(2,1)")
end

-- reported regression
do
  local x1 = 8 * 0.5
  local x2 = 8 * 0.49
  local x3 = 9 * 0.5

  assert_close(x1, 4.0, 0, "8*0.5 == 4.0")
  assert_close(x2, 3.92, 1e-12, "8*0.49 == 3.92")
  assert_close(x3, 4.5, 1e-12, "9*0.5 == 4.5")

  local f1 = math.floor(x1)
  local f2 = math.floor(x2)
  local f3 = math.floor(x3)

  assert_true(f1 == f1, "floor(8*0.5) not NaN")
  assert_true(f2 == f2, "floor(8*0.49) not NaN")
  assert_true(f3 == f3, "floor(9*0.5) not NaN")

  assert_eq(f1, 4, "floor(8*0.5)")
  assert_eq(f2, 3, "floor(8*0.49)")
  assert_eq(f3, 4, "floor(9*0.5)")
end
