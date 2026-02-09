A few notable [[Space Lua]] quirks.

# Lua implementation notes
Space Lua is intended to be a more or less complete implementation of [Lua 5.4](https://www.lua.org/manual/5.4/). However, a few features are (still) missing:

* coroutines (not planned, not useful in the SilverBullet context)
* _ENV (planned)
* Hexadecimal numeric constants with a fractional part, or binary exponents (not supported by JavaScript number parser either)


# Conversion of Strings to Numbers

Space Lua converts strings to numbers like standard Lua.

Syntax:
* Leading and trailing whitespace (space, tab, newline, carriage return, form feed and vertical tab) is trimmed.
* The entire string after trimming trailing whitespace must form a number.
* Optional `+` or `-` signs are accepted before the number.
* _Decimal integers_ and _decimal floats_ are supported with optional exponent (e.g., `42`, `-3.5`, `.5`, `5.`, `1e3`, `-2.5E-2`).
* _Hexadecimal integers_ and _hexadecimal floats_ are also supported:
  * integers (e.g., `0x10`, `-0XFF`),
  * floats require `p` or `P` exponent (e.g., `0x1.8p1`, `-0X10.3P-1`).

Failure handling:
* In _arithmetic_ and _unary minus_ expressions invalid strings cause an Lua exception:
  `attempt to perform arithmetic on a non-number`.
* `tonumber(s)` returns `nil` on failure.
* `tonumber(s, base)` parses _signed integers_ in bases 2..36 (without decimal points or exponents) and returns `nil` on invalid input string or base.

Examples (with `tonumber` function):

Code                   | Result                  | Expected
-----------------------|-------------------------|---------
`tonumber(' 42 ')`     | ${tonumber(' 42 ')}     | `42`
`tonumber('-0xFf ')`   | ${tonumber('-0xFf ')}   | `-255`
`tonumber('0x1.8p1')`  | ${tonumber('0x1.8p1')}  | `3.0`
`tonumber('1e-2')`     | ${tonumber('1e-2')}     | `0.01`
`tonumber('abc')`      | ${tonumber('abc')}      | `nil`
`tonumber('1010', 2)`  | ${tonumber('1010', 2)}  | `10`
`tonumber(' +fF', 16)` | ${tonumber(' +fF', 16)} | `255`
`tonumber('8', 8)`     | ${tonumber('8', 8)}     | `nil`

Examples (with arithmetic operations):

Code              | Result             | Expected
------------------|--------------------|--------------------
`'0xfFfFp1'`      | ${'0xfFfFp1'}      | string: `0xfFfFp1`
`'0xffffP-3' + 0` | ${'0xffffP-3' + 0} | number: `8191.875`
`-'123E-12'`      | ${-'123E-12'}      | number: `-1.23e-10`
