local function assertEqual(a, b, message)
    if a ~= b then
        if a == nil then
            a = "nil"
        end
        if b == nil then
            b = "nil"
        end
        error("Assertion failed: " .. a .. " is not equal to " .. b .. ". " .. message)
    end
end

local function assertTrue(a, message)
    if not a then
        error("Assertion failed: " .. message)
    end
end

--------------------------------------------------------------------------
-- Moonshine - a Lua virtual machine.
--
-- Email: moonshine@gamesys.co.uk
-- http://moonshinejs.org
--
-- Copyright (c) 2013-2015 Gamesys Limited. All rights reserved.
--
-- Permission is hereby granted, free of charge, to any person obtaining
-- a copy of this software and associated documentation files (the
-- "Software"), to deal in the Software without restriction, including
-- without limitation the rights to use, copy, modify, merge, publish,
-- distribute, sublicense, and/or sell copies of the Software, and to
-- permit persons to whom the Software is furnished to do so, subject to
-- the following conditions:
--
-- The above copyright notice and this permission notice shall be
-- included in all copies or substantial portions of the Software.
--
-- THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
-- EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
-- MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
-- IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
-- CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
-- TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
-- SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
--

-- STRING FUNCTIONS

-- byte

local a, b = string.byte('Mo0')

assertTrue(a == 77, 'string.byte() should return the numerical code for the first character in the first returned item')
assertTrue(b == nil, 'string.byte() should return only one item when only no length is given [1]')

local a, b = string.byte('Mo0', 2)

assertTrue(a == 111,
    'string.byte() should return the numerical code for the nth character in the first returned item, when n is specified in the second argument [1]')
assertTrue(b == nil, 'string.byte() should return only one item when only no length is given [2]')

local a, b, c = string.byte('Mo0', 2, 3)

assertTrue(a == 111,
    'string.byte() should return the numerical code for the nth character in the first returned item, when n is specified in the second argument [2]')
assertTrue(b == 48,
    'string.byte() should return the numerical code for the nth character in the first returned item, when n is specified in the second argument [3]')
assertTrue(c == nil,
    'string.byte() should return only the number of items specified in the length argument or the up to the end of the string, whichever is encountered first [1]')

local a, b, c = string.byte('Mo0', 3, 20)

assertTrue(a == 48,
    'string.byte() should return the numerical code for the nth character in the first returned item, when n is specified in the second argument [4]')
assertTrue(b == nil,
    'string.byte() should return only the number of items specified in the length argument or the up to the end of the string, whichever is encountered first [2]')

-- char

local a = string.char()
local b = string.char(116, 101, 115, 116, 105, 99, 108, 101, 115)

assertTrue(a == '', 'string.byte() should return an empty string when called with no arguments')
assertTrue(b == 'testicles',
    'string.byte() should return a string comprising of characters representing by the value each of the arguments passed')

-- dump

-- local f = function () end
-- local a = string.dump(f)
-- assertTrue (type(a) == 'string', 'string.dump() should return a string when called with a function')

-- local s = string.dump(function () return 'bar' end)
-- f = loadstring(s)
-- assertTrue (type(f) == 'function', 'loadstring() should create a function from the output of string.dump() [1]')

-- result = f()
-- assertTrue (result == 'bar', 'The result of loadstring(string.dump(f)) should behave the same as f() [1]')

-- function namedFuncWithParams (a, b) 
-- 	return a..b 
-- end

-- s = string.dump(namedFuncWithParams)
-- f = loadstring(s)
-- assertTrue (type(f) == 'function', 'loadstring() should create a function from the output of string.dump() [2]')

-- result = f('hel','lo')
-- assertTrue (result == 'hello', 'The result of loadstring(string.dump(f)) should behave the same as f() [2]')

-- find

local a = 'The quick brown fox'

local b = string.find(a, 'quick');
local c = string.find(a, 'fox');
local d = string.find(a, 'kipper');
local e = string.find(a, '');

local f = string.find(a, 'quick', 8);
local g = string.find(a, 'fox', 8);

assertTrue(b == 5,
    'string.find() should return the location of the first occurrence of the second argument within the first, if it is present [1]')
assertTrue(c == 17,
    'string.find() should return the location of the first occurrence of the second argument within the first, if it is present [2]')
assertTrue(d == nil, 'string.find() should return nil if the second argument is not contained within the first [1]')
assertTrue(e == 1, 'string.find() should return return 1 if the second argument is an empty string')
assertTrue(f == nil,
    'string.find() should return nil if the second argument is not contained within the first after the index specified by the third argument')
assertTrue(g == 17,
    'string.find() should return the location of the second argument if it is contained within the first after the index specified by the third argument')

local b, c, d, e = string.find(a, 'q(.)(.)');
assertEqual(b, 5,
    'string.find() should return the location of the first occurrence of the second argument within the first, if it is present [3]')
assertEqual(c, 7,
    'string.find() should return the location of the last character of the first occurrence of the second argument within the first, if it is present')
assertEqual(d, 'u', 'string.find() should return the groups that are specified in the regex. [1]')
assertEqual(e, 'i', 'string.find() should return the groups that are specified in the regex. [2]')

b = string.find('[', '[_%w]')
assertTrue(b == nil, 'string.find() should not return the location of special syntax [ and ].')

-- -- format

-- do
-- 	local a = string.format("%s %q", "Hello", "Lua user!")
-- 	local b = string.format("%c%c%c", 76,117,97)            -- char
-- 	local c = string.format("%e, %E", math.pi,math.pi)      -- exponent
-- 	local d1 = string.format("%f", math.pi)					-- float 
-- 	local d2 = string.format("%g", math.pi)					-- compact float

-- -- issues:
-- 	local e = string.format("%d, %i, %u", -100,-100,-100)    -- signed, signed, unsigned integer	
-- 	local f = string.format("%o, %x, %X", -100,-100,-100)    -- octal, hex, hex

-- 	local g = string.format("%%s", 100)

-- 	assertTrue (a == 'Hello "Lua user!"', 'string.format() should format %s and %q correctly')
-- 	assertTrue (b == 'Lua', 'string.format() should format %c correctly')
-- 	assertTrue (d1 == '3.141593', 'string.format() should format %f correctly')
-- 	-- assertTrue (e == '-100, -100, 4294967196', 'string.format() should format %d, %i and %u correctly')
-- 	-- assertTrue (f == '37777777634, ffffff9c, FFFFFF9C', 'string.format() should format %o, %x and %X correctly')
-- 	-- assertTrue (e == '-100, -100, 18446744073709551516', 'string.format() should format %d, %i and %u correctly')
-- 	-- assertTrue (f == '1777777777777777777634, ffffffffffffff9c, FFFFFFFFFFFFFF9C', 'string.format() should format %o, %x and %X correctly')
-- 	assertTrue (g == '%s', 'string.format() should format %% correctly')

-- -- TODO!!!
-- --	assertTrue (c == '3.141593e+00, 3.141593E+00', 'string.format() should format %e and %E correctly')
-- --	assertTrue (d2 == '3.14159', 'string.format() should format %g correctly')

-- 	a = function () string.format("%*", 100) end
-- 	b = function () string.format("%l", 100) end
-- 	c = function () string.format("%L", 100) end
-- 	d = function () string.format("%n", 100) end
-- 	e = function () string.format("%p", 100) end
-- 	f = function () string.format("%h", 100) end

-- 	assertTrue (not pcall(a), 'string.format() should error when passed %*')
-- 	assertTrue (not pcall(b), 'string.format() should error when passed %l')
-- 	assertTrue (not pcall(c), 'string.format() should error when passed %L')
-- 	assertTrue (not pcall(d), 'string.format() should error when passed %n')
-- 	assertTrue (not pcall(e), 'string.format() should error when passed %p')
-- 	assertTrue (not pcall(f), 'string.format() should error when passed %h')

-- 	a = string.format("%.3f", 5.1)
-- 	b = "Lua version " .. string.format("%.1f", 5.1)
-- 	c = string.format("pi = %.4f", math.pi)
-- 	f = string.format("%.3f", 5)

--     local d, m, y = 5, 11, 1990
--     e = string.format("%02d/%02d/%04d", d, m, y)

-- 	assertTrue (a == '5.100', 'string.format() should format floating point numbers correctly[1]')
-- 	assertTrue (b == 'Lua version 5.1', 'string.format() should format floating point numbers correctly[2]')
-- 	assertTrue (c == 'pi = 3.1416', 'string.format() should format floating point numbers correctly[3]')
-- 	assertTrue (e == '05/11/1990', 'string.format() should format decimals correctly [0]')
-- 	assertTrue (f == '5.000', 'string.format() should format floating point numbers correctly[4]')

-- 	a = function () string.format('%#####s', 'x') end
-- 	b = function () string.format('%######s', 'x') end

-- 	assertTrue (pcall(a), 'string.format() should handle five flags')
-- 	assertTrue (not pcall(b), 'string.format() should not handle six flags')

--     local tag, title = "h1", "a title"
--     a = string.format("<%s>%s</%s>", tag, title, tag)
--     b = string.format("%8s", "Lua")
--     c = string.format("%.8s", "Lua")
--     d = string.format("%.2s", "Lua")
--     e = string.format("%8.2s", "Lua")
--     f = string.format("%+8.2s", "Lua")
--     g = string.format("%-8.2s", "Lua")
--     local h = string.format("%08.2s", "Lua")
--     local i = string.format("%#8.2s", "Lua")
--     local j = string.format("% 8.2s", "Lua")
--     local k = string.format("%+-0# 8.2s", "Lua")
--     local l = string.format("%0.2s", "Lua")

-- 	assertTrue (a == '<h1>a title</h1>', 'string.format() should format strings correctly[1]')
-- 	assertTrue (b == '     Lua', 'string.format() should format strings correctly[2]')
-- 	assertTrue (c == 'Lua', 'string.format() should format strings correctly[3]')
-- 	assertTrue (d == 'Lu', 'string.format() should format strings correctly[4]')
-- 	assertTrue (e == '      Lu', 'string.format() should format strings correctly[5]')
-- 	assertTrue (f == '      Lu', 'string.format() should format strings correctly[6]')
-- 	assertTrue (g == 'Lu      ', 'string.format() should format strings correctly[7]')
-- 	assertTrue (h == '000000Lu', 'string.format() should format strings correctly[8]')
-- 	assertTrue (i == '      Lu', 'string.format() should format strings correctly[9]')
-- 	assertTrue (j == '      Lu', 'string.format() should format strings correctly[10]')
-- 	assertTrue (k == 'Lu      ', 'string.format() should format strings correctly[11]')
-- 	assertTrue (l == 'Lu', 'string.format() should format strings correctly[12]')

--     a = string.format("%8d", 123.45)
--     b = string.format("%.8d", 123.45)
--     c = string.format("%.2d", 123.45)
--     d = string.format("%8.2d", 123.45)
--     e = string.format("%+8.2d", 123.45)
--     f = string.format("%-8.2d", 123.45)
--     g = string.format("%08.2d", 123.45)
--     h = string.format("%#8.2d", 123.45)
--     i = string.format("% 8.2d", 123.45)
--     j = string.format("%+-0# 8.2d", 123.45)
--     k = string.format("%0.2d", 123.45)
--     l = string.format("%+.8d", 123.45)
--     local m = string.format("%-.8d", 123.45)
--     local n = string.format("%#.8d", 123.45)
--     local o = string.format("%0.8d", 123.45)
--     local p = string.format("% .8d", 123.45)
--     local q = string.format("%+-#0 .8d", 123.45)
--     local r = string.format("%8.5d", 123.45)
--     local s = string.format("%+8.5d", 123.45)
--     local t = string.format("%-8.5d", 123.45)
-- 	local u = string.format("%-+8.5d", 123.45)
-- 	local v = string.format("%5d", 12.3e10)
-- 	local w = string.format("%.d", 123.45)

-- 	assertTrue (a == '     123', 'string.format() should format decimals correctly[1]')
-- 	assertTrue (b == '00000123', 'string.format() should format decimals correctly[2]')
-- 	assertTrue (c == '123', 'string.format() should format decimals correctly[3]')
-- 	assertTrue (d == '     123', 'string.format() should format decimals correctly[4]')
-- 	assertTrue (e == '    +123', 'string.format() should format decimals correctly[5]')
-- 	assertTrue (f == '123     ', 'string.format() should format decimals correctly[6]')
-- 	assertTrue (g == '     123', 'string.format() should format decimals correctly[7]')
-- 	assertTrue (h == '     123', 'string.format() should format decimals correctly[8]')
-- 	assertTrue (i == '     123', 'string.format() should format decimals correctly[9]')
-- 	assertTrue (j == '+123    ', 'string.format() should format decimals correctly[10]')
-- 	assertTrue (k == '123', 'string.format() should format decimals correctly[11]')
-- 	assertTrue (l == '+00000123', 'string.format() should format decimals correctly[12]')
-- 	assertTrue (m == '00000123', 'string.format() should format decimals correctly[13]')
-- 	assertTrue (n == '00000123', 'string.format() should format decimals correctly[14]')
-- 	assertTrue (o == '00000123', 'string.format() should format decimals correctly[15]')
-- 	assertTrue (p == ' 00000123', 'string.format() should format decimals correctly[16]')
-- 	assertTrue (q == '+00000123', 'string.format() should format decimals correctly[17]')
-- 	assertTrue (r == '   00123', 'string.format() should format decimals correctly[18]')
-- 	assertTrue (s == '  +00123', 'string.format() should format decimals correctly[19]')
-- 	assertTrue (t == '00123   ', 'string.format() should format decimals correctly[20]')
-- 	assertTrue (u == '+00123  ', 'string.format() should format decimals correctly[21]')
-- 	assertTrue (v == '123000000000', 'string.format() should format decimals correctly[22]')
-- 	assertTrue (w == '123', 'string.format() should format decimals correctly[23]')

--     a = string.format("%8d", -123.45)
--     b = string.format("%.8d", -123.45)
--     c = string.format("%.2d", -123.45)
--     d = string.format("%8.2d", -123.45)
--     e = string.format("%+8.2d", -123.45)
--     f = string.format("%-8.2d", -123.45)
--     g = string.format("%08.2d", -123.45)
--     h = string.format("%#8.2d", -123.45)
--     i = string.format("% 8.2d", -123.45)
--     j = string.format("%+-0# 8.2d", -123.45)
--     k = string.format("%0.2d", -123.45)
--     l = string.format("%+.8d", -123.45)
--     m = string.format("%-.8d", -123.45)
--     n = string.format("%#.8d", -123.45)
--     o = string.format("%0.8d", -123.45)
--     p = string.format("% .8d", -123.45)
--     q = string.format("%+-#0 .8d", -123.45)
--     r = string.format("%8.5d", -123.45)
--     s = string.format("%+8.5d", -123.45)
--     t = string.format("%-8.5d", -123.45)
-- 	u = string.format("%-+8.5d", -123.45)
-- 	v = string.format("%5d", -12.3e10)
-- 	w = string.format("%.d", -123.45)

-- 	assertTrue (a == '    -123', 'string.format() should format decimals correctly[31]')
-- 	assertTrue (b == '-00000123', 'string.format() should format decimals correctly[32]')
-- 	assertTrue (c == '-123', 'string.format() should format decimals correctly[33]')
-- 	assertTrue (d == '    -123', 'string.format() should format decimals correctly[34]')
-- 	assertTrue (e == '    -123', 'string.format() should format decimals correctly[35]')
-- 	assertTrue (f == '-123    ', 'string.format() should format decimals correctly[36]')
-- 	assertTrue (g == '    -123', 'string.format() should format decimals correctly[37]')
-- 	assertTrue (h == '    -123', 'string.format() should format decimals correctly[38]')
-- 	assertTrue (i == '    -123', 'string.format() should format decimals correctly[39]')
-- 	assertTrue (j == '-123    ', 'string.format() should format decimals correctly[40]')
-- 	assertTrue (k == '-123', 'string.format() should format decimals correctly[41]')
-- 	assertTrue (l == '-00000123', 'string.format() should format decimals correctly[42]')
-- 	assertTrue (m == '-00000123', 'string.format() should format decimals correctly[43]')
-- 	assertTrue (n == '-00000123', 'string.format() should format decimals correctly[44]')
-- 	assertTrue (o == '-00000123', 'string.format() should format decimals correctly[45]')
-- 	assertTrue (p == '-00000123', 'string.format() should format decimals correctly[46]')
-- 	assertTrue (q == '-00000123', 'string.format() should format decimals correctly[47]')
-- 	assertTrue (r == '  -00123', 'string.format() should format decimals correctly[48]')
-- 	assertTrue (s == '  -00123', 'string.format() should format decimals correctly[49]')
-- 	assertTrue (t == '-00123  ', 'string.format() should format decimals correctly[50]')
-- 	assertTrue (u == '-00123  ', 'string.format() should format decimals correctly[51]')
-- 	assertTrue (v == '-123000000000', 'string.format() should format decimals correctly[52]')
-- 	assertTrue (w == '-123', 'string.format() should format decimals correctly[53]')

-- 	a = string.format("%+05.d", 123.45)
-- 	b = string.format("%05d", 123.45)
-- 	c = string.format("%05d", -123.45)
-- 	d = string.format("%+05d", 123.45)

-- 	assertTrue (a == ' +123', 'string.format() should format decimals correctly[60]')
-- 	assertTrue (b == '00123', 'string.format() should format decimals correctly[61]')
-- 	assertTrue (c == '-0123', 'string.format() should format decimals correctly[62]')
-- 	assertTrue (d == '+0123', 'string.format() should format decimals correctly[63]')

--     a = string.format("%8f", 123.45)
--     b = string.format("%.8f", 123.45)
--     c = string.format("%.1f", 123.45)
--     d = string.format("%8.2f", 123.45)
--     e = string.format("%+8.2f", 123.45)
--     f = string.format("%-8.3f", 123.45)
--     g = string.format("%08.3f", 123.45)
--     h = string.format("%#8.3f", 123.45)
--     i = string.format("% 8.3f", 123.45)
--     j = string.format("%+-0# 8.2f", 123.45)
--     k = string.format("%0.2f", 123.45)
--     l = string.format("%+.8f", 123.45)
--     m = string.format("%-.8f", 123.45)
--     n = string.format("%#.8f", 123.45)
--     o = string.format("%9.3f", 123.45)
--     p = string.format("%+9.3f", 123.45)
--     q = string.format("%-9.3f", 123.45)
-- 	r = string.format("%-+9.3f", 123.45)
-- 	s = string.format("%.0f", 123.45)
-- 	t = string.format("%.4f", 123.05)

-- 	assertTrue (a == '123.450000', 'string.format() should format floats correctly[1]')
-- 	assertTrue (b == '123.45000000', 'string.format() should format floats correctly[2]')
-- 	assertTrue (c == '123.5', 'string.format() should format floats correctly[3]')
-- 	assertTrue (d == '  123.45', 'string.format() should format floats correctly[4]')
-- 	assertTrue (e == ' +123.45', 'string.format() should format floats correctly[5]')
-- 	assertTrue (f == '123.450 ', 'string.format() should format floats correctly[6]')
-- 	assertTrue (g == '0123.450', 'string.format() should format floats correctly[7]')
-- 	assertTrue (h == ' 123.450', 'string.format() should format floats correctly[8]')
-- 	assertTrue (i == ' 123.450', 'string.format() should format floats correctly[9]')
-- 	assertTrue (j == '+123.45 ', 'string.format() should format floats correctly[10]')
-- 	assertTrue (k == '123.45', 'string.format() should format floats correctly[11]')
-- 	assertTrue (l == '+123.45000000', 'string.format() should format floats correctly[12]')
-- 	assertTrue (m == '123.45000000', 'string.format() should format floats correctly[13]')
-- 	assertTrue (n == '123.45000000', 'string.format() should format floats correctly[14]')
-- 	assertTrue (o == '  123.450', 'string.format() should format floats correctly[15]')
-- 	assertTrue (p == ' +123.450', 'string.format() should format floats correctly[16]')
-- 	assertTrue (q == '123.450  ', 'string.format() should format floats correctly[17]')
-- 	assertTrue (r == '+123.450 ', 'string.format() should format floats correctly[18]')
-- 	assertTrue (s == '123', 'string.format() should format floats correctly[19]')
-- 	assertTrue (t == '123.0500', 'string.format() should format floats correctly[20]')

-- 	a = string.format("%x", 123)
-- 	b = string.format("%x", 123.45)
-- 	c = string.format("%x", -123)
-- 	d = string.format("%4x", 123)
-- 	e = string.format("%.4x", 123)
-- 	f = string.format("%8.4x", 123)
-- 	g = string.format("%+8.4x", 123)
-- 	h = string.format("%-8.4x", 123)
-- 	i = string.format("%#8.4x", 123)
-- 	j = string.format("%08.4x", 123)
-- 	k = string.format("% 8.4x", 123)
-- 	l = string.format("%+-#0 8.4x", 123)
-- 	m = string.format("%08x", 123)
-- 	n = string.format("% x", 123)

-- 	assertTrue (a == '7b', 'string.format() should format hex correctly[1]')
-- 	assertTrue (b == '7b', 'string.format() should format hex correctly[2]')
-- 	assertTrue (c == 'ffffffffffffff85', 'string.format() should format hex correctly[3]')
-- 	assertTrue (d == '  7b', 'string.format() should format hex correctly[4]')
-- 	assertTrue (e == '007b', 'string.format() should format hex correctly[5]')
-- 	assertTrue (f == '    007b', 'string.format() should format hex correctly[6]')
-- 	assertTrue (g == '    007b', 'string.format() should format hex correctly[7]')
-- 	assertTrue (h == '007b    ', 'string.format() should format hex correctly[8]')
-- 	assertTrue (i == '  0x007b', 'string.format() should format hex correctly[9]')
-- 	assertTrue (k == '    007b', 'string.format() should format hex correctly[11]')
-- 	assertTrue (l == '0x007b  ', 'string.format() should format hex correctly[12]')
-- 	assertTrue (n == '7b', 'string.format() should format hex correctly[14]')

-- 	a = string.format("%8.2f\n", 1.234)
-- 	b = string.format("\n%8.2f", 1.234)
-- 	c = string.format("\n%8.2f\n", 1.234)

-- 	assertTrue (a == '    1.23\n', 'string.format() should correctly format patterns that contain new lines.[1]')
-- 	assertTrue (b == '\n    1.23', 'string.format() should correctly format patterns that contain new lines.[2]')
-- 	assertTrue (c == '\n    1.23\n', 'string.format() should correctly format patterns that contain new lines.[3]')

-- -- TODO!!!!
-- --	assertTrue (j == '    007b', 'string.format() should format hex correctly[10]')
-- --	assertTrue (m == '0000007b', 'string.format() should format hex correctly[13]')

-- -- print (c)

-- end

-- gmatch

local s = "from=world, to=Lua"
local x = string.gmatch(s, "(%w+)=(%w+)")

assertTrue(type(x) == 'function', 'string.gmatch() should return an iterator function')

local a, b, c = x()
assertTrue(a == 'from', 'string.gmatch() iterator should return the first group matched in the string [1]')
assertTrue(b == 'world', 'string.gmatch() iterator should return the second group matched in the string [1]')
assertTrue(c == nil, 'string.gmatch() iterator should return nil after all groups are matched [1]')

local a, b, c = x()
assertTrue(a == 'to', 'string.gmatch() iterator should return the first group matched in the string [2]')
assertTrue(b == 'Lua', 'string.gmatch() iterator should return the second group matched in the string [2]')
assertTrue(c == nil, 'string.gmatch() iterator should return nil after all groups are matched [2]')

local a = x()
assertTrue(a == nil, 'string.gmatch() iterator should return nil after all matches have ben returned')

local x = string.gmatch(s, "%w+=%w+")
local a, b = x()
assertTrue(a == 'from=world', 'string.gmatch() iterator should return the first match when no groups are specified')
assertTrue(b == nil,
    'string.gmatch() iterator should return nil as second return value when no groups are specified [1]')

local a, b = x()
assertTrue(a == 'to=Lua', 'string.gmatch() iterator should return the second match when no groups are specified')
assertTrue(b == nil,
    'string.gmatch() iterator should return nil as second return value when no groups are specified [2]')

do
    local x = string.gmatch(';a;', 'a*')
    local a, b, c, d, e, f = x(), x(), x(), x(), x(), x();

    assertEqual(a, '', 'string.gmatch() iterator should return correct values [1]')
    assertEqual(b, 'a', 'string.gmatch() iterator should return correct values [2]')
    assertEqual(c, '', 'string.gmatch() iterator should return correct values [3]')
    --    assertEqual(d, '', 'string.gmatch() iterator should return correct values [4]')
    assertEqual(e, nil, 'string.gmatch() iterator should return correct values [5]')
    assertEqual(e, nil, 'string.gmatch() iterator should return correct values [6]')
end

-- gsub

a = '<%?xml version="1.0" encoding="UTF%-8"%?>'
b = '<?xml version="1.0" encoding="UTF-8"?><my-xml></my-xml>'

c = string.gsub(b, a, 'moo')

assertTrue(c == 'moo<my-xml></my-xml>', 'string.gsub() should replace the matched part of the string[1]')
-- Not even scraping the surface

a = '%%1'
b = 'Hello %1'

c = string.gsub(b, a, 'world')
assertTrue(c == 'Hello world', 'string.gsub() should replace the matched part of the string[2]')

a = '%d'
b = 'ab5kfd8scf4lll'
c = function(x)
    return '(' .. x .. ')'
end

d = string.gsub(b, a, c, 2)
assertTrue(d == 'ab(5)kfd(8)scf4lll',
    'string.gsub() should replace the matched part of the string with the value returned from the given map function')

a = "[^:]+"
b = ":aa:bbb:cccc:ddddd:eee:"
c = function(subStr)
end

d = string.gsub(b, a, c)
assertTrue(d == ':aa:bbb:cccc:ddddd:eee:',
    'string.gsub() should not replace the matched part of the string if the value returned from the map function is nil')

c = function(subStr)
    return 'X'
end

d = string.gsub(b, a, c)
assertTrue(d == ':X:X:X:X:X:',
    'string.gsub() should replace the matched part of the string if the value returned from the map function is not nil')

-- c = string.gsub(';a;', 'a*', 'ITEM')
-- assertTrue(c == 'ITEM;ITEMITEM;ITEM', 'string.gsub() should replace the matched part of the string[2]')

a = 'abc\\def'
b = string.gsub(a, '\\', '\\\\')
assertEqual(b, 'abc\\\\def', 'string.gsub() should allow backslashes')

a = "a = 'a', b = 'b', c = 'c',"
b = string.gsub(a, ",$", "")
assertEqual(b, "a = 'a', b = 'b', c = 'c'", 'string.gsub() should match $ with end of string')

-- len

local a = 'McLaren Mercedes'

local b = string.len('');
local c = string.len(a);

assertTrue(b == 0, 'string.len() should return 0 if passed an empty string')
assertTrue(c == 16, 'string.len() should return the length of the string in the first argument')

-- lower

local a = 'McLaren Mercedes'

local b = string.lower('');
local c = string.lower(a);

assertTrue(b == '', 'string.lower() should return an empty string if passed an empty string')
assertTrue(c == 'mclaren mercedes',
    'string.lower() should return the string in the first argument with all character in lower case')

-- match

local a = string.match('20/11/1988', "^%d+%p%d+%p%d%d%d%d$")
assertEqual(a, '20/11/1988', 'string.match() should handle punctuation.')

local a = ('foo@bar.com'):match("^[%w+%.%-_]+@[%w+%.%-_]+%.%a%a+$")

local a = ('test-123_test.2@a-b_c.movie'):match("^[%w+%.%-_]+@[%w+%.%-_]+%.%a%a+$")
assertEqual(a, 'test-123_test.2@a-b_c.movie', 'string.match() should flatten nested groups.')

local a = ('-=[]\';'):match("%W")
assertEqual(a, '-', 'string.match() match non-word chars.')

-- rep

local a = 'Ho'

local b = string.rep(a, 0);
local c = string.rep(a, 1);
local d = string.rep(a, 3);

assertTrue(b == '', 'string.rep() should return an empty string if the second argument is 0')
assertTrue(c == 'Ho', 'string.rep() should return the first argument if the second argument is 1')
assertTrue(d == 'HoHoHo',
    'string.rep() should return a string containing the first argument repeated the second argument number of times')

-- reverse

local a = string.reverse('');
local b = string.reverse('x');
local c = string.reverse('tpircSavaJ');

assertTrue(a == '', 'string.reverse() should return an empty string if passed an empty string')
assertTrue(b == 'x', 'string.reverse() should return the first argument if its length is 1')
assertTrue(c == 'JavaScript', 'string.reverse() should return a string containing the first argument reversed')

-- sub

local a = 'Pub Standards'

local b = string.sub(a, 1)
local c = string.sub(a, 5)
local d = string.sub(a, -4)

local e = string.sub(a, 1, 3)
local f = string.sub(a, 7, 9)
local g = string.sub(a, -4, -2)

local h = string.sub(a, 5, -2)
local i = string.sub(a, 0)

assertTrue(b == 'Pub Standards', 'string.sub() should return the first argument if the second argument is 1')
assertTrue(c == 'Standards',
    'string.sub() should return a subset of the first argument from the nth character onwards, when n is the second argument and positive')
assertTrue(d == 'ards',
    'string.sub() should return the last n characters of the first argument, where n is the absolute value of the second argument and the second argument is negative')
assertTrue(e == 'Pub',
    'string.sub() should return the first n characters of the first argument when the second argument is one and n is the third argument')
assertTrue(f == 'and',
    'string.sub() should return a subset of the first argument from the nth character to the mth character, when n is the second argument and positive and m is the third argument and negative')

assertTrue(h == 'Standard',
    'string.sub() should return a subset of the first argument from the nth character to the last but mth character, when n is the second argument and positive and m is the third argument and negative')
assertTrue(i == 'Pub Standards',
    'string.sub() should return a subset of the first argument from the last but nth character to the last but mth character, when n is the second argument and negative and m is the third argument and negative')

-- upper

local a = string.upper('');
local b = string.upper('JavaScript');

assertTrue(a == '', 'string.upper() should return an empty string if passed an empty string')
assertTrue(b == 'JAVASCRIPT', 'string.upper() should return the first argument in uppercase')

-- `string` lib as metatable of strings.
local strMeta = getmetatable('')
assertEqual(strMeta.__index, string, 'String lib should be metamethod of string instances.')

a = ('Hey'):lower()
assertEqual(a, 'hey', 'String lib should be metamethod of string instances.')

