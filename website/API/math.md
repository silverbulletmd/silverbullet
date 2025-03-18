API docs for Lua's `math` module.

## math.random(m?, n?)
Returns a random number.
- `random()` returns a random float in range [0,1)
- `random(m)` returns a random integer in range [1,m]
- `random(m,n)` returns a random integer in range [m,n]

Example:
```lua
print(math.random())      -- prints: 0.123456789 (random float between 0 and 1)
print(math.random(10))    -- prints: 5 (random integer between 1 and 10)
print(math.random(5, 10)) -- prints: 7 (random integer between 5 and 10)
```

## math.abs(x)
Returns the absolute value of `x`.

Example:
```lua
print(math.abs(-5))  -- prints: 5
print(math.abs(5))   -- prints: 5
```

## math.ceil(x)
Returns the smallest integer greater than or equal to `x`.

Example:
```lua
print(math.ceil(4.2))   -- prints: 5
print(math.ceil(-4.2))  -- prints: -4
```

## math.floor(x)
Returns the largest integer less than or equal to `x`.

Example:
```lua
print(math.floor(4.8))   -- prints: 4
print(math.floor(-4.8))  -- prints: -5
```

## math.max(...)
Returns the maximum value among its arguments.

Example:
```lua
print(math.max(1, 2, 3, 4, 5))  -- prints: 5
print(math.max(-10, -5, -1))    -- prints: -1
```

## math.min(...)
Returns the minimum value among its arguments.

Example:
```lua
print(math.min(1, 2, 3, 4, 5))  -- prints: 1
print(math.min(-10, -5, -1))    -- prints: -10
```

## math.fmod(x, y)
Returns the remainder of the division of `x` by `y` that rounds the quotient towards zero.

Example:
```lua
print(math.fmod(10, 3))    -- prints: 1
print(math.fmod(-10, 3))   -- prints: -1
```

## math.modf(x)
Returns two numbers, the integral part of `x` and the fractional part of `x`.

Example:
```lua
local intPart, fracPart = math.modf(3.14)
print(intPart, fracPart)   -- prints: 3    0.14
```

## math.exp(x)
Returns the value e^x (where e is the base of natural logarithms).

Example:
```lua
print(math.exp(0))    -- prints: 1
print(math.exp(1))    -- prints: 2.7182818284590455
```

## math.log(x, base?)
Returns the logarithm of `x` in the given base. If base is not specified, returns the natural logarithm of `x`.

Example:
```lua
print(math.log(10))       -- prints: 2.302585092994046 (natural log)
print(math.log(100, 10))  -- prints: 2 (log base 10)
```

## math.pow(x, y)
Returns x^y.

Example:
```lua
print(math.pow(2, 3))   -- prints: 8
print(math.pow(10, 2))  -- prints: 100
```

## math.sqrt(x)
Returns the square root of `x`.

Example:
```lua
print(math.sqrt(16))   -- prints: 4
print(math.sqrt(2))    -- prints: 1.4142135623730951
```

## math.cos(x)
Returns the cosine of `x` (in radians).

Example:
```lua
print(math.cos(0))          -- prints: 1
print(math.cos(math.pi))    -- prints: -1
```

## math.sin(x)
Returns the sine of `x` (in radians).

Example:
```lua
print(math.sin(0))                  -- prints: 0
print(math.sin(math.pi / 2))        -- prints: 1
```

## math.tan(x)
Returns the tangent of `x` (in radians).

Example:
```lua
print(math.tan(0))             -- prints: 0
print(math.tan(math.pi / 4))   -- prints: 1
```

## math.acos(x)
Returns the arc cosine of `x` (in radians).

Example:
```lua
print(math.acos(1))    -- prints: 0
print(math.acos(0))    -- prints: 1.5707963267948966 (pi/2)
```

## math.asin(x)
Returns the arc sine of `x` (in radians).

Example:
```lua
print(math.asin(0))    -- prints: 0
print(math.asin(1))    -- prints: 1.5707963267948966 (pi/2)
```

## math.atan(y, x?)
Returns the arc tangent of `y/x` (in radians). If `x` is not provided, returns the arc tangent of `y` (in radians).

Example:
```lua
print(math.atan(1))        -- prints: 0.7853981633974483 (pi/4)
print(math.atan(1, 1))     -- prints: 0.7853981633974483 (pi/4)
```

## math.cosh(x)
Returns the hyperbolic cosine of `x`.

Example:
```lua
print(math.cosh(0))   -- prints: 1
```

## math.sinh(x)
Returns the hyperbolic sine of `x`.

Example:
```lua
print(math.sinh(0))   -- prints: 0
```

## math.tanh(x)
Returns the hyperbolic tangent of `x`.

Example:
```lua
print(math.tanh(0))   -- prints: 0
```

## math.deg(x)
Converts angle `x` from radians to degrees.

Example:
```lua
print(math.deg(math.pi))      -- prints: 180
print(math.deg(math.pi/2))    -- prints: 90
```

## math.rad(x)
Converts angle `x` from degrees to radians.

Example:
```lua
print(math.rad(180))    -- prints: 3.141592653589793
print(math.rad(90))     -- prints: 1.5707963267948966
```

## math.ult(m, n)
Returns a boolean, true if integer `m` is below integer `n` when they are compared as unsigned integers.

Example:
```lua
print(math.ult(2, 3))     -- prints: true
print(math.ult(-1, 1))    -- prints: false (as unsigned integers)
```

# Non-standard Extensions
## math.cosineSimilarity(vecA, vecB)
Returns the cosine similarity between two vectors.

Example:
```lua
local vec1 = {1, 2, 3}
local vec2 = {4, 5, 6}
print(math.cosineSimilarity(vec1, vec2))  -- prints: 0.9746318461970762
```