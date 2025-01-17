local function assert_equal(a, b)
  if a ~= b then
      error("Assertion failed: " .. a .. " is not equal to " .. b)
  end
end

-- Trigonometric functions
assert_equal(math.cos(0), 1)
assert_equal(math.sin(0), 0)
assert_equal(math.tan(0), 0)
assert_equal(math.acos(1), 0)
assert_equal(math.asin(0), 0)
assert_equal(math.atan(0), 0)

-- Hyperbolic functions
assert_equal(math.cosh(0), 1)
assert_equal(math.sinh(0), 0)
assert_equal(math.tanh(0), 0)

-- Basic functions
assert_equal(math.abs(-5), 5)
assert_equal(math.ceil(3.3), 4)
assert_equal(math.floor(3.7), 3)
assert_equal(math.max(1, 2, 3, 4), 4)
assert_equal(math.min(1, 2, 3, 4), 1)

-- Rounding and remainder
assert_equal(math.fmod(7, 3), 1)

-- Power and logarithms
assert_equal(math.exp(0), 1)
assert_equal(math.log(math.exp(1)), 1)
assert_equal(math.log(8, 2), 3)  -- log base 2 of 8
assert_equal(math.pow(2, 3), 8)
assert_equal(math.sqrt(9), 3)


-- Random number tests (basic range checks)
local rand = math.random()
assert_equal(rand >= 0 and rand < 1, true)
local rand_n = math.random(10)
assert_equal(rand_n >= 1 and rand_n <= 10, true)
local rand_range = math.random(5, 10)
assert_equal(rand_range >= 5 and rand_range <= 10, true)

-- Unsigned less than comparison
assert_equal(math.ult(1, 2), true)
assert_equal(math.ult(2, 1), false)
