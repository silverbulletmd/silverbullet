local function assertEquals(a, b, message)
    if a ~= b then
        error('Assertion failed: ' ..
        tostring(a) .. ' is not equal to ' .. tostring(b) .. (message and (' | ' .. message) or ''))
    end
end

local function assertThrows(msg_substr, fn)
    local ok, err = pcall(fn)

    if ok then
        error('Assertion failed: expected error containing "'
        .. msg_substr .. '"')
    end

    if type(err) ~= 'string' then
        err = tostring(err)
    end

    if not string.find(err, msg_substr, 1, true) then
        error('Assertion failed: expected error message to contain "'
        .. msg_substr .. '", got: "' .. err .. '"')
    end
end

-- helper for whitespace handling tests
local chr = string.char
-- no base: whitespace handling
assertEquals(tonumber(chr(32, 9, 10, 11, 12, 13) .. '42'), 42)
assertEquals(tonumber('42' .. chr(32, 9, 10, 11, 12, 13)), 42)

-- converting numbers that are already numbers
assertEquals(tonumber(0), 0)
assertEquals(tonumber(10), 10)

-- no base: zeroes
assertEquals(tonumber('-0'), 0)
assertEquals(tonumber('0x0p0'), 0.0)
assertEquals(tonumber('0x.0p10'), 0.0)

-- no base: valid decimal integers and floats
assertEquals(tonumber('123'), 123)
assertEquals(tonumber('+123'), 123)
assertEquals(tonumber('-123'), -123)
assertEquals(tonumber('0'), 0)
assertEquals(tonumber('000123'), 123)
assertEquals(tonumber('123.45'), 123.45)
assertEquals(tonumber('5.'), 5.0)
assertEquals(tonumber('.5'), 0.5)
assertEquals(tonumber('5.e1'), 50.0)
assertEquals(tonumber('.5e2'), 50.0)
assertEquals(tonumber('-.5e2'), -50.0)
assertEquals(tonumber('1e-2'), 0.01)
assertEquals(tonumber('1E+2'), 100.0)

-- no base: valid hexadecimal integers (no exponent)
assertEquals(tonumber('0x10'), 16)
assertEquals(tonumber('0X10'), 16)
assertEquals(tonumber('+0x10'), 16)
assertEquals(tonumber('-0x10'), -16)
assertEquals(tonumber(' 0x0 '), 0)
assertEquals(tonumber('0x000F'), 15)
assertEquals(tonumber('0XdeadBEEF'), 3735928559)

-- no base: valid hexadecimal floats (with exponent)
assertEquals(tonumber('0x1p0'), 1.0)
assertEquals(tonumber('0x1p+0'), 1.0)
assertEquals(tonumber('0x1p-2'), 0.25)
assertEquals(tonumber('0x1.0p-2'), 0.25)
assertEquals(tonumber('0x1.8p1'), 3.0)
assertEquals(tonumber('0x.8p0'), 0.5)
assertEquals(tonumber('0x.Fp4'), 15.0)
assertEquals(tonumber('0XA.P-1'), 5.0)
assertEquals(tonumber('  0x10P0  '), 16.0)
assertEquals(tonumber('-0x10p0'), -16.0)
assertEquals(tonumber('0x10.2p0'), 16.125)
assertEquals(tonumber('0x10.3P-1'), 8.09375)
assertEquals(tonumber('-0X10.3P-1'), -8.09375)
assertEquals(tonumber('0x1.2'), 1.125)

-- no base: invalid
assertEquals(tonumber(''), nil)
assertEquals(tonumber(' '), nil)
assertEquals(tonumber('abc'), nil)
assertEquals(tonumber('12.34.56'), nil)
assertEquals(tonumber('e10'), nil)
assertEquals(tonumber('.e1'), nil)
assertEquals(tonumber('1e'), nil)
assertEquals(tonumber('1e+'), nil)
assertEquals(tonumber('0x'), nil)
assertEquals(tonumber('0xG'), nil)
assertEquals(tonumber('+ 10'), nil)
assertEquals(tonumber('- 10'), nil)
assertEquals(tonumber('123x'), nil)

-- with base: whitespace handling
assertEquals(tonumber(chr(32, 9, 10, 11, 12, 13) .. 'FF', 16), 255)
assertEquals(tonumber('FF' .. chr(32, 9, 10, 11, 12, 13), 16), 255)

-- with base: valid
assertEquals(tonumber('1010', 2), 10)
assertEquals(tonumber('+1011', 2), 11)
assertEquals(tonumber('ff', 16), 255)
assertEquals(tonumber('FF', 16), 255)
assertEquals(tonumber('fF', 16), 255)
assertEquals(tonumber('377', 8), 255)
assertEquals(tonumber('z', 36), 35)
assertEquals(tonumber('Aa', 11), 120)
assertEquals(tonumber('  ff  ', 16), 255)
assertEquals(tonumber('1010', 10), 1010)

-- with base: invalid
assertThrows("bad argument #2 to 'tonumber' (base out of range)",
    function()
        return tonumber('1010', 1)
    end
)

assertThrows("bad argument #2 to 'tonumber' (base out of range)",
    function()
        return tonumber('1010', 37)
    end
)

assertEquals(tonumber('FF', 10), nil)
assertEquals(tonumber('8', 8), nil)
assertEquals(tonumber('2', 2), nil)
assertEquals(tonumber('', 16), nil)
assertEquals(tonumber(' ', 16), nil)
assertEquals(tonumber('+', 16), nil)
assertEquals(tonumber('-', 16), nil)
assertEquals(tonumber('+ FF', 16), nil)
assertEquals(tonumber('1_0', 10), nil)
assertEquals(tonumber('123x', 10), nil)
