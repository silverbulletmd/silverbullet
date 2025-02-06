local function assertEqual(a, b)
  if a ~= b then
    error("Assertion failed: " .. a .. " is not equal to " .. b)
  end
end

-- Trigonometric functions
assertEqual(math.cos(0), 1)
assertEqual(math.sin(0), 0)
assertEqual(math.tan(0), 0)
assertEqual(math.acos(1), 0)
assertEqual(math.asin(0), 0)
assertEqual(math.atan(0), 0)

-- Hyperbolic functions
assertEqual(math.cosh(0), 1)
assertEqual(math.sinh(0), 0)
assertEqual(math.tanh(0), 0)

-- Basic functions
assertEqual(math.abs(-5), 5)
assertEqual(math.ceil(3.3), 4)
assertEqual(math.floor(3.7), 3)
assertEqual(math.max(1, 2, 3, 4), 4)
assertEqual(math.min(1, 2, 3, 4), 1)

-- Rounding and remainder
assertEqual(math.fmod(7, 3), 1)

-- Power and logarithms
assertEqual(math.exp(0), 1)
assertEqual(math.log(math.exp(1)), 1)
assertEqual(math.log(8, 2), 3) -- log base 2 of 8
assertEqual(math.pow(2, 3), 8)
assertEqual(math.sqrt(9), 3)


-- Random number tests (basic range checks)
local rand = math.random()
assertEqual(rand >= 0 and rand < 1, true)
local randN = math.random(10)
assertEqual(randN >= 1 and randN <= 10, true)
local randRange = math.random(5, 10)
assertEqual(randRange >= 5 and randRange <= 10, true)

-- Unsigned less than comparison
assertEqual(math.ult(1, 2), true)
assertEqual(math.ult(2, 1), false)
