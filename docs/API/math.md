---
tags: api/lua
references:
- client/space_lua/stdlib/math.ts
---

The `math` namespace contains Lua-compatible numeric functions plus Space Lua's `cosineSimilarity` helper.

<!--#lua spacelua.renderApiDocumentation("math") -->
## math.abs

`math.abs(x)`

Returns the absolute value of `x`.

**Parameters:**

- `x` (`number`)

**Returns:**

- `number`

## math.acos

`math.acos(x)`

Returns the arc cosine of `x` in radians.

**Parameters:**

- `x` (`number`)

**Returns:**

- `number`

## math.asin

`math.asin(x)`

Returns the arc sine of `x` in radians.

**Parameters:**

- `x` (`number`)

**Returns:**

- `number`

## math.atan

`math.atan(y, x?)`

Returns the arc tangent of `y/x` in radians, using `1` for omitted `x`.

**Parameters:**

- `y` (`number`)
- `x?` (`number`)

**Returns:**

- `number`

## math.ceil

`math.ceil(x)`

Returns the smallest integer greater than or equal to `x`.

**Parameters:**

- `x` (`number`)

**Returns:**

- `integer`

## math.cos

`math.cos(x)`

Returns the cosine of `x` radians.

**Parameters:**

- `x` (`number`)

**Returns:**

- `number`

## math.cosh

`math.cosh(x)`

> **Deprecated:** Retained for compatibility with older Lua versions.

Returns the hyperbolic cosine of `x`.

**Parameters:**

- `x` (`number`)

**Returns:**

- `number`

## math.cosineSimilarity

`math.cosineSimilarity(vecA, vecB)`

Returns the cosine similarity between two equal-length numeric vectors.

**Parameters:**

- `vecA` (`table`)
- `vecB` (`table`)

**Returns:**

- `number` — Cosine similarity.

**Example:**

```lua
print(math.cosineSimilarity({1, 2, 3}, {4, 5, 6}))
```

## math.deg

`math.deg(x)`

Converts an angle from radians to degrees.

**Parameters:**

- `x` (`number`)

**Returns:**

- `number`

**Example:**

```lua
print(math.deg(math.pi)) -- 180
```

## math.exp

`math.exp(x)`

Returns `e` raised to `x`.

**Parameters:**

- `x` (`number`)

**Returns:**

- `number`

## math.floor

`math.floor(x)`

Returns the largest integer less than or equal to `x`.

**Parameters:**

- `x` (`number`)

**Returns:**

- `integer`

## math.fmod

`math.fmod(x, y)`

Returns the remainder of `x / y` with the quotient rounded toward zero.

**Parameters:**

- `x` (`number`)
- `y` (`number`)

**Returns:**

- `number`

## math.frexp

`math.frexp(x)`

Decomposes `x` into a normalized fraction and a power-of-two exponent.

**Parameters:**

- `x` (`number`)

**Returns:**

- `number` — Fraction.
- `integer` — Exponent.

## math.ldexp

`math.ldexp(m, e)`

Returns `m * 2^e`, the inverse of `math.frexp`.

**Parameters:**

- `m` (`number`)
- `e` (`integer`)

**Returns:**

- `number`

## math.log

`math.log(x, base?)`

Returns the logarithm of `x`, using the natural base unless another base is supplied.

**Parameters:**

- `x` (`number`)
- `base?` (`number`)

**Returns:**

- `number`

**Example:**

```lua
print(math.log(100, 10)) -- 2
```

## math.max

`math.max(x, ...): number`

Returns the greatest of its arguments.

**Returns:**

- `number`

## math.min

`math.min(x, ...): number`

Returns the least of its arguments.

**Returns:**

- `number`

## math.modf

`math.modf(x)`

Splits `x` into its integral and fractional parts.

**Parameters:**

- `x` (`number`)

**Returns:**

- `integer` — Integral part.
- `float` — Fractional part.

**Example:**

```lua
local integer, fraction = math.modf(3.14)
```

## math.pow

`math.pow(x, y)`

> **Deprecated:** Use the `^` operator instead.

Returns `x` raised to the power `y`.

**Parameters:**

- `x` (`number`)
- `y` (`number`)

**Returns:**

- `number`

## math.rad

`math.rad(x)`

Converts an angle from degrees to radians.

**Parameters:**

- `x` (`number`)

**Returns:**

- `number`

## math.random

`math.random(): number`
`math.random(n): integer`
`math.random(m, n): integer`

Returns a pseudo-random float or an integer in a requested inclusive range.

**Parameters:**

- `m?` (`integer`)
- `n?` (`integer`)

**Returns:**

- `number` — Pseudo-random result.

**Example:**

```lua
print(math.random())
print(math.random(10))
print(math.random(5, 10))
```

## math.randomseed

`math.randomseed(): integer, integer`
`math.randomseed(x, y): integer, integer`

Seeds the pseudo-random generator and returns the two seeds used.

**Parameters:**

- `x?` (`integer`)
- `y?` (`integer`)

**Returns:**

- `integer` — First seed.
- `integer` — Second seed.

## math.sin

`math.sin(x)`

Returns the sine of `x` radians.

**Parameters:**

- `x` (`number`)

**Returns:**

- `number`

## math.sinh

`math.sinh(x)`

> **Deprecated:** Retained for compatibility with older Lua versions.

Returns the hyperbolic sine of `x`.

**Parameters:**

- `x` (`number`)

**Returns:**

- `number`

## math.sqrt

`math.sqrt(x)`

Returns the square root of `x`.

**Parameters:**

- `x` (`number`)

**Returns:**

- `number`

## math.tan

`math.tan(x)`

Returns the tangent of `x` radians.

**Parameters:**

- `x` (`number`)

**Returns:**

- `number`

## math.tanh

`math.tanh(x)`

> **Deprecated:** Retained for compatibility with older Lua versions.

Returns the hyperbolic tangent of `x`.

**Parameters:**

- `x` (`number`)

**Returns:**

- `number`

## math.tointeger

`math.tointeger(x)`

Converts a value to an integer when it has an exact finite integral representation.

**Parameters:**

- `x` — Value to convert.

**Returns:**

- `integer|nil` — Converted integer or `nil`.

## math.type

`math.type(x)`

Returns `integer` or `float` for a number, or `nil` for other values.

**Parameters:**

- `x` — Value to inspect.

**Returns:**

- `string|nil` — Numeric subtype or `nil`.

## math.ult

`math.ult(m, n)`

Compares two integers as unsigned 32-bit values.

**Parameters:**

- `m` (`integer`)
- `n` (`integer`)

**Returns:**

- `boolean`

**Example:**

```lua
print(math.ult(2, 3)) -- true
```
<!--/lua-->

