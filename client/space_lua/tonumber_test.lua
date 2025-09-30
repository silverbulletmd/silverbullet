local function assert_equal(a, b, message)
    if a ~= b then
        error('Assertion failed: ' .. a .. ' is not equal to ' .. b .. ' ' .. message)
    end
end

-- Test tonumber decimal
assert_equal(tonumber('123'),    123   )
assert_equal(tonumber('123.45'), 123.45)
assert_equal(tonumber('-123'),  -123   )
assert_equal(tonumber('0'),      0     )

assert_equal(tonumber(''),         nil)
assert_equal(tonumber(' '),        nil)
assert_equal(tonumber('abc'),      nil)
assert_equal(tonumber('12.34.56'), nil)

-- Test tonumber hexadecimal
assert_equal(tonumber(' 16'       ),  16      )
assert_equal(tonumber('-16'       ), -16      )
assert_equal(tonumber(' 0x10'     ),  16      )
--assert_equal(tonumber('-0x10'     ), -16      )
assert_equal(tonumber(' 0X10p0'   ),  16      )
assert_equal(tonumber('-0X10p0'   ), -16      )
assert_equal(tonumber(' 0X10P-1'  ),   8      )
assert_equal(tonumber('-0X10P-1'  ),  -8      )
assert_equal(tonumber(' 0X10.3P-1'),   8.09375)
assert_equal(tonumber('-0X10.3P-1'),  -8.09375)

-- Test tonumber with base
assert_equal(tonumber('1010',  2), 10  ) -- Binary
assert_equal(tonumber('fF',   16), 255 ) -- Hexadecimal
assert_equal(tonumber('377',   8), 255 ) -- Octal
assert_equal(tonumber('z',    36), 35  ) -- Base 36
assert_equal(tonumber('1010', 10), 1010) -- Decimal (explicit)

assert_equal(tonumber('1010',  1), nil) -- Invalid base
assert_equal(tonumber('1010', 37), nil) -- Invalid base
assert_equal(tonumber('FF',   10), nil) -- Invalid hex in decimal
assert_equal(tonumber('8',     8), nil) -- Invalid octal digit
