local function assert_eq(a, b, message)
  if a ~= b then
    error('Assertion failed: ' .. tostring(a) .. ' is not equal to ' .. tostring(b) .. (message and (' | ' .. message) or ''))
  end
end

-- helper for whitespace handling tests
local chr = string.char
-- no base: whitespace handling
assert_eq(tonumber(        chr(32, 9, 10, 11, 12, 13) .. '42'), 42)
assert_eq(tonumber('42' .. chr(32, 9, 10, 11, 12, 13)),         42)

-- no base: zeroes
assert_eq(tonumber('-0'),      0  )
assert_eq(tonumber('0x0p0'),   0.0)
assert_eq(tonumber('0x.0p10'), 0.0)

-- no base: valid decimal integers and floats
assert_eq(tonumber('123'   ),  123   )
assert_eq(tonumber('+123'  ),  123   )
assert_eq(tonumber('-123'  ), -123   )
assert_eq(tonumber('0'     ),    0   )
assert_eq(tonumber('000123'),  123   )
assert_eq(tonumber('123.45'),  123.45)
assert_eq(tonumber('5.'    ),    5.0 )
assert_eq(tonumber('.5'    ),    0.5 )
assert_eq(tonumber('5.e1'  ),   50.0 )
assert_eq(tonumber('.5e2'  ),   50.0 )
assert_eq(tonumber('-.5e2' ),  -50.0 )
assert_eq(tonumber('1e-2'  ),    0.01)
assert_eq(tonumber('1E+2'  ),  100.0 )

-- no base: valid hexadecimal integers (no exponent)
assert_eq(tonumber('0x10'      ),         16)
assert_eq(tonumber('0X10'      ),         16)
assert_eq(tonumber('+0x10'     ),         16)
assert_eq(tonumber('-0x10'     ),        -16)
assert_eq(tonumber(' 0x0 '     ),          0)
assert_eq(tonumber('0x000F'    ),         15)
assert_eq(tonumber('0XdeadBEEF'), 3735928559)

-- no base: valid hexadecimal floats (with exponent)
assert_eq(tonumber('0x1p0'     ),   1.0    )
assert_eq(tonumber('0x1p+0'    ),   1.0    )
assert_eq(tonumber('0x1p-2'    ),   0.25   )
assert_eq(tonumber('0x1.0p-2'  ),   0.25   )
assert_eq(tonumber('0x1.8p1'   ),   3.0    )
assert_eq(tonumber('0x.8p0'    ),   0.5    )
assert_eq(tonumber('0x.Fp4'    ),  15.0    )
assert_eq(tonumber('0XA.P-1'   ),   5.0    )
assert_eq(tonumber('  0x10P0  '),  16.0    )
assert_eq(tonumber('-0x10p0'   ), -16.0    )
assert_eq(tonumber('0x10.2p0'  ),  16.125  )
assert_eq(tonumber('0x10.3P-1' ),   8.09375)
assert_eq(tonumber('-0X10.3P-1'),  -8.09375)

-- no base: invalid
assert_eq(tonumber(''        ), nil)
assert_eq(tonumber(' '       ), nil)
assert_eq(tonumber('abc'     ), nil)
assert_eq(tonumber('12.34.56'), nil)
assert_eq(tonumber('e10'     ), nil)
assert_eq(tonumber('.e1'     ), nil)
assert_eq(tonumber('1e'      ), nil)
assert_eq(tonumber('1e+'     ), nil)
assert_eq(tonumber('0x'      ), nil)
assert_eq(tonumber('0xG'     ), nil)
assert_eq(tonumber('0x1.2'   ), nil)
assert_eq(tonumber('+ 10'    ), nil)
assert_eq(tonumber('- 10'    ), nil)
assert_eq(tonumber('123x'    ), nil)

-- with base: whitespace handling
assert_eq(tonumber(        chr(32, 9, 10, 11, 12, 13) .. 'FF', 16), 255)
assert_eq(tonumber('FF' .. chr(32, 9, 10, 11, 12, 13),         16), 255)

-- with base: valid
assert_eq(tonumber('1010',    2),   10)
assert_eq(tonumber('+1011',   2),   11)
assert_eq(tonumber('ff',     16),  255)
assert_eq(tonumber('FF',     16),  255)
assert_eq(tonumber('fF',     16),  255)
assert_eq(tonumber('377',     8),  255)
assert_eq(tonumber('z',      36),   35)
assert_eq(tonumber('Aa',     11),  120)
assert_eq(tonumber('  ff  ', 16),  255)
assert_eq(tonumber('1010',   10), 1010)

-- with base: invalid
assert_eq(tonumber('1010',  1), nil)
assert_eq(tonumber('1010', 37), nil)
assert_eq(tonumber('FF',   10), nil)
assert_eq(tonumber('8',     8), nil)
assert_eq(tonumber('2',     2), nil)
assert_eq(tonumber('',     16), nil)
assert_eq(tonumber(' ',    16), nil)
assert_eq(tonumber('+',    16), nil)
assert_eq(tonumber('-',    16), nil)
assert_eq(tonumber('+ FF', 16), nil)
assert_eq(tonumber('1_0',  10), nil)
assert_eq(tonumber('123x', 10), nil)
