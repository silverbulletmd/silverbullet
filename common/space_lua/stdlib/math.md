API docs for Lua's `math` module.

## math.random(m?, n?)
Generates random numbers. Without arguments, returns a float in [0,1). With one argument m, returns integer in [1,m]. With two arguments, returns integer in [m,n].

Example:
```lua
print(math.random())      -- prints: 0.7259081864761557
print(math.random(10))    -- prints: 7 (random number from 1-10)
print(math.random(5,10))  -- prints: 8 (random number from 5-10)
```

## math.abs(x)
Returns the absolute value of `x`.

Example:
```lua
print(math.abs(-5))   -- prints: 5
print(math.abs(3.7))  -- prints: 3.7
```

## math.ceil(x)
Returns the smallest integer larger than or equal to `x`.

Example:
```lua
print(math.ceil(3.3))   -- prints: 4
print(math.ceil(-3.3))  -- prints: -3
```

## math.floor(x)
Returns the largest integer smaller than or equal to `x`.

Example:
```lua
print(math.floor(3.7))   -- prints: 3
print(math.floor(-3.7))  -- prints: -4
```

## math.max(...)
Returns the maximum value among its arguments.

Example:
```lua
print(math.max(1, 2, 3, 4))     -- prints: 4
print(math.max(-5, -2, -10))    -- prints: -2
```

## math.min(...)
Returns the minimum value among its arguments.

Example:
```lua
print(math.min(1, 2, 3, 4))     -- prints: 1
print(math.min(-5, -2, -10))    -- prints: -10
```

## math.fmod(x, y)
Returns the remainder of the division of `x` by `y`.

Example:
```lua
print(math.fmod(7, 3))    -- prints: 1
print(math.fmod(7, 2))    -- prints: 1
```

## math.modf(x)
Returns the integral part and fractional part of `x`.

Example:
```lua
local int, frac = table.unpack(math.modf(3.7))
print(int, frac)    -- prints: 3 0.7
```

## math.exp(x)
Returns e raised to the power of `x`.

Example:
```lua
print(math.exp(0))    -- prints: 1
print(math.exp(1))    -- prints: 2.718281828459045
```

## math.log(x, base?)
Returns the natural logarithm of `x` or the logarithm of `x` to the given base.

Example:
```lua
print(math.log(math.exp(1)))    -- prints: 1
print(math.log(8, 2))           -- prints: 3
```

## math.pow(x, y)
Returns `x` raised to the power `y`.

Example:
```lua
print(math.pow(2, 3))    -- prints: 8
print(math.pow(3, 2))    -- prints: 9
```

## math.sqrt(x)
Returns the square root of `x`.

Example:
```lua
print(math.sqrt(9))     -- prints: 3
print(math.sqrt(2))     -- prints: 1.4142135623730951
```

## math.cos(x)
Returns the cosine of `x` (in radians).

Example:
```lua
print(math.cos(0))        -- prints: 1
```

## math.sin(x)
Returns the sine of `x` (in radians).

Example:
```lua
print(math.sin(0))               -- prints: 0
```

## math.tan(x)
Returns the tangent of `x` (in radians).

Example:
```lua
print(math.tan(0))        -- prints: 0
```

## math.acos(x)
Returns the arc cosine of `x` (in radians).

Example:
```lua
print(math.acos(1))    -- prints: 0
print(math.acos(0))    -- prints: 1.5707963267948966
```

## math.asin(x)
Returns the arc sine of `x` (in radians).

Example:
```lua
print(math.asin(0))    -- prints: 0
print(math.asin(1))    -- prints: 1.5707963267948966
```

## math.atan(y, x?)
Returns the arc tangent of `y/x` (in radians). If `x` is not provided, returns the arc tangent of `y`.

Example:
```lua
print(math.atan(0))        -- prints: 0
print(math.atan(1, 1))     -- prints: 0.7853981633974483
```

## math.cosh(x)
Returns the hyperbolic cosine of `x`.

Example:
```lua
print(math.cosh(0))    -- prints: 1
print(math.cosh(1))    -- prints: 1.5430806348152437
```

## math.sinh(x)
Returns the hyperbolic sine of `x`.

Example:
```lua
print(math.sinh(0))    -- prints: 0
print(math.sinh(1))    -- prints: 1.1752011936438014
```

## math.tanh(x)
Returns the hyperbolic tangent of `x`.

Example:
```lua
print(math.tanh(0))    -- prints: 0
print(math.tanh(1))    -- prints: 0.7615941559557649
```

## math.deg(x)
Converts angle `x` from radians to degrees.


## math.rad(x)
Converts angle `x` from degrees to radians.

Example:
```lua
print(math.rad(180))    -- prints: 3.141592653589793
print(math.rad(90))     -- prints: 1.5707963267948966
```

## math.ult(m, n)
Returns true if `m` is less than `n` when they are considered unsigned integers.

Example:
```lua
print(math.ult(1, 2))    -- prints: true
print(math.ult(2, 1))    -- prints: false
```

# Non-standard Extensions
## math.cosineSimilarity(vecA, vecB)
Returns the cosine similarity between two vectors.

Example:
```lua
local vec1 = {1, 2, 3}
local vec2 = {4, 5, 6}
print(math.cosineSimilarity(vec1, vec2))    -- prints: 0.9746318461970762
```
