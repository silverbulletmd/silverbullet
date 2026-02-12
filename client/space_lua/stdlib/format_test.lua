local function assertEquals(actual, expected, message)
  if actual ~= expected then
    error('Assertion failed: ' .. message
      .. '\n  actual:   ' .. tostring(actual)
      .. '\n  expected: ' .. tostring(expected), 2)
  end
end

local function assertThrows(msg_substr, fn)
  local ok, err = pcall(fn)
  if ok then
    error('Assertion failed: expected error containing "'
      .. msg_substr .. '"', 2)
  end
  if type(err) ~= 'string' then
    err = tostring(err)
  end
  if not string.find(err, msg_substr, 1, true) then
    error('Assertion failed: expected error message to contain "'
      .. msg_substr .. '", got: "' .. err .. '"', 2)
  end
end

-- %%: literal percent
assertEquals(string.format("%%"), "%", "%%: literal")
assertEquals(string.format("100%%"), "100%", "%%: 100%%")
assertEquals(string.format("%%%%"), "%%", "%%: %%%%")
assertEquals(string.format("a%%b%%c"), "a%b%c", "%%: a%%b%%c")

-- %d: basic integers
assertEquals(string.format("%d", 0), "0", "%d: 0")
assertEquals(string.format("%d", 1), "1", "%d: 1")
assertEquals(string.format("%d", -1), "-1", "%d: -1")
assertEquals(string.format("%d", 42), "42", "%d: 42")
assertEquals(string.format("%d", -42), "-42", "%d: -42")
assertEquals(string.format("%d", 2147483647), "2147483647", "%d: INT_MAX")
assertEquals(string.format("%d", -2147483648), "-2147483648", "%d: INT_MIN")

-- %i: alias for %d
assertEquals(string.format("%i", 42), "42", "%i: 42")
assertEquals(string.format("%i", -7), "-7", "%i: -7")

-- %d: width
assertEquals(string.format("%5d", 42), "   42", "%d: width 5")
assertEquals(string.format("%5d", -42), "  -42", "%d: width 5 neg")
assertEquals(string.format("%1d", 42), "42", "%d: width 1 no pad")

-- %d: left-justify
assertEquals(string.format("%-5d", 42), "42   ", "%d: left 42")
assertEquals(string.format("%-5d", -42), "-42  ", "%d: left -42")

-- %d: zero-pad
assertEquals(string.format("%05d", 42), "00042", "%d: zero-pad 42")
assertEquals(string.format("%05d", -42), "-0042", "%d: zero-pad -42")
assertEquals(string.format("%05d", 0), "00000", "%d: zero-pad 0")

-- %d: plus flag
assertEquals(string.format("%+d", 42), "+42", "%d: +42")
assertEquals(string.format("%+d", -42), "-42", "%d: + -42")
assertEquals(string.format("%+d", 0), "+0", "%d: +0")

-- %d: space flag
assertEquals(string.format("% d", 42), " 42", "%d: space 42")
assertEquals(string.format("% d", -42), "-42", "%d: space -42")
assertEquals(string.format("% d", 0), " 0", "%d: space 0")

-- %d: precision
assertEquals(string.format("%.5d", 42), "00042", "%d: prec5 42")
assertEquals(string.format("%.5d", -42), "-00042", "%d: prec5 -42")
assertEquals(string.format("%.0d", 0), "", "%d: prec0 0")
assertEquals(string.format("%.0d", 1), "1", "%d: prec0 1")
assertEquals(string.format("%.1d", 0), "0", "%d: prec1 0")

-- %d: width and precision
assertEquals(string.format("%8.5d", 42), "   00042", "%d: w8 p5 42")
assertEquals(string.format("%-8.5d", 42), "00042   ", "%d: left w8 p5 42")

-- %u: unsigned integers
assertEquals(string.format("%u", 0), "0", "%u: 0")
assertEquals(string.format("%u", 42), "42", "%u: 42")
assertEquals(string.format("%u", -1), "18446744073709551615", "%u: -1")
assertEquals(string.format("%u", -42), "18446744073709551574", "%u: -42")

-- %o: octal
assertEquals(string.format("%o", 0), "0", "%o: 0")
assertEquals(string.format("%o", 8), "10", "%o: 8")
assertEquals(string.format("%o", 255), "377", "%o: 255")
assertEquals(string.format("%o", -1), "1777777777777777777777", "%o: -1")

-- %o: alt flag
assertEquals(string.format("%#o", 0), "0", "%#o: 0")
assertEquals(string.format("%#o", 8), "010", "%#o: 8")
assertEquals(string.format("%#o", 255), "0377", "%#o: 255")

-- %x: hex lowercase
assertEquals(string.format("%x", 0), "0", "%x: 0")
assertEquals(string.format("%x", 255), "ff", "%x: 255")
assertEquals(string.format("%x", 4095), "fff", "%x: 4095")
assertEquals(string.format("%x", -1), "ffffffffffffffff", "%x: -1")

-- %X: hex uppercase
assertEquals(string.format("%X", 255), "FF", "%X: 255")
assertEquals(string.format("%X", -1), "FFFFFFFFFFFFFFFF", "%X: -1")

-- %x: alt flag
assertEquals(string.format("%#x", 0), "0", "%#x: 0")
assertEquals(string.format("%#x", 255), "0xff", "%#x: 255")
assertEquals(string.format("%#X", 255), "0XFF", "%#X: 255")

-- %x: width and zero-pad
assertEquals(string.format("%08x", 255), "000000ff", "%x: zero-pad 255")
assertEquals(string.format("%#08x", 255), "0x0000ff", "%#x: zero-pad 255")

-- %c: character
assertEquals(string.format("%c", 65), "A", "%c: 65")
assertEquals(string.format("%c", 97), "a", "%c: 97")
assertEquals(string.format("%c", 48), "0", "%c: 48")

-- %c: width
assertEquals(string.format("%3c", 65), "  A", "%c: width 3")
assertEquals(string.format("%-3c", 65), "A  ", "%c: left width 3")

-- %s: strings
assertEquals(string.format("%s", "hello"), "hello", "%s: hello")
assertEquals(string.format("%s", ""), "", "%s: empty")
assertEquals(string.format("%s %s", "hello", "world"), "hello world", "%s: two")

-- %s: width
assertEquals(string.format("%10s", "hello"), "     hello", "%s: width 10")
assertEquals(string.format("%-10s", "hello"), "hello     ", "%s: left width 10")

-- %s: precision truncates
assertEquals(string.format("%.3s", "hello"), "hel", "%s: prec3")
assertEquals(string.format("%.10s", "hello"), "hello", "%s: prec10")
assertEquals(string.format("%.0s", "hello"), "", "%s: prec0")

-- %s: width and precision
assertEquals(string.format("%10.3s", "hello"), "       hel", "%s: w10 p3")
assertEquals(string.format("%-10.3s", "hello"), "hel       ", "%s: left w10 p3")

-- %f: basic floats
assertEquals(string.format("%f", 0), "0.000000", "%f: 0")
assertEquals(string.format("%f", 1), "1.000000", "%f: 1")
assertEquals(string.format("%f", -1), "-1.000000", "%f: -1")
assertEquals(string.format("%f", 3.14), "3.140000", "%f: 3.14")
assertEquals(string.format("%f", 0.1), "0.100000", "%f: 0.1")

-- %f: precision
assertEquals(string.format("%.2f", 3.14159), "3.14", "%f: prec2")
assertEquals(string.format("%.0f", 3.14159), "3", "%f: prec0")
assertEquals(string.format("%.10f", 1.0), "1.0000000000", "%f: prec10")

-- %f: width and precision
assertEquals(string.format("%10.2f", 3.14), "      3.14", "%f: w10 p2")
assertEquals(string.format("%-10.2f", 3.14), "3.14      ", "%f: left w10 p2")
assertEquals(string.format("%010.2f", 3.14), "0000003.14", "%f: zero-pad w10 p2")

-- %f: sign flags
assertEquals(string.format("%+f", 3.14), "+3.140000", "%f: +3.14")
assertEquals(string.format("%+f", -3.14), "-3.140000", "%f: + -3.14")
assertEquals(string.format("% f", 3.14), " 3.140000", "%f: space 3.14")
assertEquals(string.format("% f", -3.14), "-3.140000", "%f: space -3.14")

-- %f: non-finite
assertEquals(string.format("%f", 1/0), "inf", "%f: inf")
assertEquals(string.format("%f", -1/0), "-inf", "%f: -inf")
assertEquals(string.format("%f", 0/0), "-nan", "%f: nan")
assertEquals(string.format("%+f", 1/0), "+inf", "%f: +inf")

-- %f: width with non-finite
assertEquals(string.format("%10f", 1/0), "       inf", "%f: w10 inf")
assertEquals(string.format("%-10f", 1/0), "inf       ", "%f: left w10 inf")

-- %e: basic
assertEquals(string.format("%e", 0), "0.000000e+00", "%e: 0")
assertEquals(string.format("%e", 1), "1.000000e+00", "%e: 1")
assertEquals(string.format("%e", 100), "1.000000e+02", "%e: 100")
assertEquals(string.format("%e", 0.001), "1.000000e-03", "%e: 0.001")
assertEquals(string.format("%e", -42), "-4.200000e+01", "%e: -42")

-- %E: uppercase
assertEquals(string.format("%E", 100), "1.000000E+02", "%E: 100")

-- %e: precision
assertEquals(string.format("%.2e", 100), "1.00e+02", "%e: prec2")
assertEquals(string.format("%.0e", 100), "1e+02", "%e: prec0")
assertEquals(string.format("%.14e", 1), "1.00000000000000e+00", "%e: prec14")

-- %e: non-finite
assertEquals(string.format("%e", 1/0), "inf", "%e: inf")
assertEquals(string.format("%e", -1/0), "-inf", "%e: -inf")
assertEquals(string.format("%e", 0/0), "-nan", "%e: nan")

-- %e: width and flags
assertEquals(string.format("%15e", 100), "   1.000000e+02", "%e: w15")
assertEquals(string.format("%-15e", 100), "1.000000e+02   ", "%e: left w15")
assertEquals(string.format("%+e", 100), "+1.000000e+02", "%e: +100")

-- %g: basic
assertEquals(string.format("%g", 0), "0", "%g: 0")
assertEquals(string.format("%g", 1), "1", "%g: 1")
assertEquals(string.format("%g", 100), "100", "%g: 100")
assertEquals(string.format("%g", 100000), "100000", "%g: 100000")
assertEquals(string.format("%g", 1000000), "1e+06", "%g: 1000000")
assertEquals(string.format("%g", 0.0001), "0.0001", "%g: 0.0001")
assertEquals(string.format("%g", 0.00001), "1e-05", "%g: 0.00001")
assertEquals(string.format("%g", -42), "-42", "%g: -42")

-- %G: uppercase
assertEquals(string.format("%G", 1e6), "1E+06", "%G: 1e6")
assertEquals(string.format("%G", 1e-5), "1E-05", "%G: 1e-5")

-- %g: precision
assertEquals(string.format("%.1g", 3.14), "3", "%g: prec1")
assertEquals(string.format("%.2g", 3.14), "3.1", "%g: prec2")
assertEquals(string.format("%.4g", 3.14159), "3.142", "%g: prec4")
assertEquals(string.format("%.0g", 3.14), "3", "%g: prec0")
assertEquals(string.format("%.10g", 1), "1", "%g: prec10 int")

-- %g: strips trailing zeros
assertEquals(string.format("%.6g", 1.0), "1", "%g: strip 1.0")
assertEquals(string.format("%.6g", 1.5), "1.5", "%g: strip 1.5")
assertEquals(string.format("%.6g", 1.50), "1.5", "%g: strip 1.50")
assertEquals(string.format("%.14g", 1.0), "1", "%g: strip prec14 1.0")
assertEquals(string.format("%.14g", 1.5), "1.5", "%g: strip prec14 1.5")

-- %g: alt flag keeps trailing zeros and dot
assertEquals(string.format("%#g", 1.0), "1.00000", "%#g: 1.0")
assertEquals(string.format("%#.2g", 1.0), "1.0", "%#g: prec2 1.0")
assertEquals(string.format("%#.4g", 100), "100.0", "%#g: prec4 100")

-- %g: non-finite
assertEquals(string.format("%g", 1/0), "inf", "%g: inf")
assertEquals(string.format("%g", -1/0), "-inf", "%g: -inf")
assertEquals(string.format("%g", 0/0), "-nan", "%g: nan")
assertEquals(string.format("%+g", 1/0), "+inf", "%g: +inf")

-- %g: width and flags
assertEquals(string.format("%10g", 42), "        42", "%g: w10 42")
assertEquals(string.format("%-10g", 42), "42        ", "%g: left w10 42")
assertEquals(string.format("%010g", 42), "0000000042", "%g: zero-pad w10 42")
assertEquals(string.format("%+g", 42), "+42", "%g: +42")
assertEquals(string.format("% g", 42), " 42", "%g: space 42")

-- %g: Lua 5.4 %.14g reference values
assertEquals(string.format("%.14g", 0.0), "0", "%.14g: 0.0")
assertEquals(string.format("%.14g", 1.0), "1", "%.14g: 1.0")
assertEquals(string.format("%.14g", 1/3), "0.33333333333333", "%.14g: 1/3")
assertEquals(string.format("%.14g", math.pi), "3.1415926535898", "%.14g: pi")
assertEquals(string.format("%.14g", 1e-10), "1e-10", "%.14g: 1e-10")
assertEquals(string.format("%.14g", 1e18), "1e+18", "%.14g: 1e18")
assertEquals(string.format("%.14g", 2^63), "9.2233720368548e+18", "%.14g: 2^63")
assertEquals(string.format("%.14g", 2^53), "9.007199254741e+15", "%.14g: 2^53")
assertEquals(string.format("%.14g", 1.7976931348623e+308), "1.7976931348623e+308", "%.14g: max")
assertEquals(string.format("%.14g", 5e-324), "4.9406564584125e-324", "%.14g: min subnormal")
assertEquals(string.format("%.14g", 0/0), "-nan", "%.14g: nan")
assertEquals(string.format("%.14g", 1/0), "inf", "%.14g: inf")
assertEquals(string.format("%.14g", -1/0), "-inf", "%.14g: -inf")

-- mixed: multiple specifiers
assertEquals(string.format("%d + %d = %d", 1, 2, 3), "1 + 2 = 3", "mixed: d+d=d")
assertEquals(string.format("%s is %d", "age", 42), "age is 42", "mixed: s is d")
assertEquals(string.format("[%05d] %s (%.2f)", 7, "test", 3.14), "[00007] test (3.14)", "mixed: complex")

-- mixed: no specifiers
assertEquals(string.format("hello world"), "hello world", "mixed: no spec")
assertEquals(string.format(""), "", "mixed: empty")

-- error: invalid specifier (Lua 5.4 says "invalid conversion", 5.5 may differ)
do
  local ok = pcall(string.format, "%z", 1)
  assertEquals(ok, false, "%z: should error")
end

-- error: trailing percent
do
  local ok = pcall(string.format, "abc%")
  assertEquals(ok, false, "trailing %%: should error")
end

-- %f: negative zero
assertEquals(string.format("%f", -0.0), "-0.000000", "%f: -0.0")
assertEquals(string.format("%e", -0.0), "-0.000000e+00", "%e: -0.0")
assertEquals(string.format("%g", -0.0), "-0", "%g: -0.0")

-- %f: large precision
do
  local s = string.format("%.20f", 1.0)
  assertEquals(string.find(s, "%.") ~= nil, true, "%f: large prec has dot")
  assertEquals(#s, 22, "%f: large prec length")
end

-- zero width is no-op
assertEquals(string.format("%0d", 42), "42", "%0d: no-op")

-- %a: basic hex floats
assertEquals(string.format("%a", 0), "0x0p+0", "%a: 0")
assertEquals(string.format("%a", 1), "0x1p+0", "%a: 1")
assertEquals(string.format("%a", -1), "-0x1p+0", "%a: -1")
assertEquals(string.format("%a", 2), "0x1p+1", "%a: 2")
assertEquals(string.format("%a", 0.5), "0x1p-1", "%a: 0.5")
assertEquals(string.format("%a", 1.5), "0x1.8p+0", "%a: 1.5")
assertEquals(string.format("%a", -0.0), "-0x0p+0", "%a: -0.0")

-- %A: uppercase
assertEquals(string.format("%A", 1.5), "0X1.8P+0", "%A: 1.5")
assertEquals(string.format("%A", 255), "0X1.FEP+7", "%A: 255")

-- %a: precision
assertEquals(string.format("%.0a", 1.5), "0x2p+0", "%a: prec0 1.5")
assertEquals(string.format("%.1a", 1.5), "0x1.8p+0", "%a: prec1 1.5")
assertEquals(string.format("%.4a", 1.5), "0x1.8000p+0", "%a: prec4 1.5")
assertEquals(string.format("%.4a", 1), "0x1.0000p+0", "%a: prec4 1")

-- %a: width and flags
assertEquals(string.format("%20a", 1.5), "            0x1.8p+0", "%a: w20 1.5")
assertEquals(string.format("%-20a", 1.5), "0x1.8p+0            ", "%a: left w20 1.5")
assertEquals(string.format("%+a", 1.5), "+0x1.8p+0", "%a: +1.5")
assertEquals(string.format("% a", 1.5), " 0x1.8p+0", "%a: space 1.5")

-- %a: non-finite
assertEquals(string.format("%a", 1/0), "inf", "%a: inf")
assertEquals(string.format("%a", -1/0), "-inf", "%a: -inf")
assertEquals(string.format("%a", 0/0), "-nan", "%a: nan")
assertEquals(string.format("%A", 1/0), "INF", "%A: inf")

-- %a: Math.PI
assertEquals(string.format("%a", math.pi), "0x1.921fb54442d18p+1", "%a: pi")

-- %a: 0.1
assertEquals(string.format("%a", 0.1), "0x1.999999999999ap-4", "%a: 0.1")

-- %q: nil and booleans
assertEquals(string.format("%q", nil), "nil", "%q: nil")
assertEquals(string.format("%q", true), "true", "%q: true")
assertEquals(string.format("%q", false), "false", "%q: false")

-- %q: integers
assertEquals(string.format("%q", 0), "0", "%q: 0")
assertEquals(string.format("%q", 1), "1", "%q: 1")
assertEquals(string.format("%q", -1), "-1", "%q: -1")
assertEquals(string.format("%q", 42), "42", "%q: 42")
assertEquals(string.format("%q", -42), "-42", "%q: -42")

-- %q: floats as hex
assertEquals(string.format("%q", 1.5), "0x1.8p+0", "%q: 1.5")
assertEquals(string.format("%q", 0.1), "0x1.999999999999ap-4", "%q: 0.1")
assertEquals(string.format("%q", math.pi), "0x1.921fb54442d18p+1", "%q: pi")
assertEquals(string.format("%q", -0.5), "-0x1p-1", "%q: -0.5")
assertEquals(string.format("%q", -0.0), "-0x0p+0", "%q: -0.0")

-- %q: non-finite numbers
assertEquals(string.format("%q", 0/0), "(0/0)", "%q: nan")
assertEquals(string.format("%q", 1/0), "1e9999", "%q: inf")
assertEquals(string.format("%q", -1/0), "-1e9999", "%q: -inf")

-- %q: simple strings
assertEquals(string.format("%q", "hello"), '"hello"', "%q: hello")
assertEquals(string.format("%q", ""), '""', "%q: empty")

-- %q: strings with special characters
assertEquals(string.format("%q", 'say "hi"'), '"say \\"hi\\""', '%q: quotes')
assertEquals(string.format("%q", "back\\slash"), '"back\\\\slash"', "%q: backslash")
assertEquals(string.format("%q", "line\nbreak"), '"line\\\nbreak"', "%q: newline")
assertEquals(string.format("%q", "cr\rreturn"), '"cr\\13return"', "%q: cr")
assertEquals(string.format("%q", "tab\there"), '"tab\\9here"', "%q: tab")

-- %q: Lua reference example
do
  local result = string.format("%q", 'a string with "quotes" and \n new line')
  assertEquals(result, '"a string with \\"quotes\\" and \\\n new line"', "%q: reference")
end

-- %q: mixed with other specifiers
assertEquals(
  string.format("name=%q age=%d", "Alice", 30),
  'name="Alice" age=30',
  "%q: mixed"
)

-- %p: pointer-like identity for tables
do
  local t1 = {}
  local t2 = {}
  local s1 = string.format("%p", t1)
  local s2 = string.format("%p", t2)
  -- starts with 0x
  assertEquals(s1:sub(1, 2), "0x", "%p: table prefix")
  -- same object gives same result
  assertEquals(string.format("%p", t1), s1, "%p: stable identity")
  -- different objects give different results
  assertEquals(s1 ~= s2, true, "%p: distinct tables differ")
end

-- %p: functions get an identity too
do
  local f1 = function() end
  local f2 = function() end
  local s1 = string.format("%p", f1)
  local s2 = string.format("%p", f2)
  assertEquals(s1:sub(1, 2), "0x", "%p: function prefix")
  assertEquals(s1 ~= s2, true, "%p: distinct functions differ")
end

-- %p: nil and primitives yield (null)
assertEquals(string.format("%p", nil), "(null)", "%p: nil")
assertEquals(string.format("%p", true), "(null)", "%p: boolean")
assertEquals(string.format("%p", 42), "(null)", "%p: number")

-- %p: strings get an identity (they are GC objects in Lua)
do
  local s = string.format("%p", "hello")
  assertEquals(s:sub(1, 2), "0x", "%p: string prefix")
end

-- %p: width
do
  local t = {}
  local s = string.format("%20p", t)
  assertEquals(#s >= 20, true, "%p: width pads")
end

-- %p: left-justify
do
  local t = {}
  local s = string.format("%-20p", t)
  assertEquals(#s >= 20, true, "%p: left width pads")
  -- trailing spaces
  assertEquals(s:sub(#s, #s), " ", "%p: left-justify trailing space")
end

-- %p: pointer-like identity for tables
do
  local t1 = {}
  local t2 = {}
  local s1 = string.format("%p", t1)
  local s2 = string.format("%p", t2)
  assertEquals(s1:sub(1, 2), "0x", "%p: table prefix")
  assertEquals(string.format("%p", t1), s1, "%p: table stable identity")
  assertEquals(s1 ~= s2, true, "%p: distinct tables differ")
end

-- %p: functions get an identity too
do
  local f1 = function() end
  local f2 = function() end
  local s1 = string.format("%p", f1)
  local s2 = string.format("%p", f2)
  assertEquals(s1:sub(1, 2), "0x", "%p: function prefix")
  assertEquals(string.format("%p", f1), s1, "%p: function stable identity")
  assertEquals(s1 ~= s2, true, "%p: distinct functions differ")
end

-- %p: strings get an identity (interned: same content = same id)
do
  local s1 = string.format("%p", "hello")
  local s2 = string.format("%p", "hello")
  local s3 = string.format("%p", "world")
  assertEquals(s1:sub(1, 2), "0x", "%p: string prefix")
  assertEquals(s1, s2, "%p: same string content = same id")
  assertEquals(s1 ~= s3, true, "%p: different string content differs")
end

-- %p: nil and primitives yield (null)
assertEquals(string.format("%p", nil), "(null)", "%p: nil")
assertEquals(string.format("%p", true), "(null)", "%p: boolean")
assertEquals(string.format("%p", 42), "(null)", "%p: number")

-- %p: repeated calls on same table are stable
do
  local t = {}
  local ids = {}
  for i = 1, 5 do
    ids[i] = string.format("%p", t)
  end
  for i = 2, 5 do
    assertEquals(ids[i], ids[1], "%p: repeated call #" .. i .. " stable")
  end
end

-- %p: table stored in another table keeps identity
do
  local inner = {}
  local outer = { ref = inner }
  local s1 = string.format("%p", inner)
  local s2 = string.format("%p", outer.ref)
  assertEquals(s1, s2, "%p: table via reference stable")
end

-- %p: width
do
  local t = {}
  local s = string.format("%20p", t)
  assertEquals(#s >= 20, true, "%p: width pads")
end

-- %p: left-justify
do
  local t = {}
  local s = string.format("%-20p", t)
  assertEquals(#s >= 20, true, "%p: left width pads")
  assertEquals(s:sub(#s, #s), " ", "%p: left-justify trailing space")
end
