local function assert_eq(actual, expected, message)
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
assert_eq(string.format("%%"), "%", "%%: literal")
assert_eq(string.format("100%%"), "100%", "%%: 100%%")
assert_eq(string.format("%%%%"), "%%", "%%: %%%%")
assert_eq(string.format("a%%b%%c"), "a%b%c", "%%: a%%b%%c")

-- %d: basic integers
assert_eq(string.format("%d", 0), "0", "%d: 0")
assert_eq(string.format("%d", 1), "1", "%d: 1")
assert_eq(string.format("%d", -1), "-1", "%d: -1")
assert_eq(string.format("%d", 42), "42", "%d: 42")
assert_eq(string.format("%d", -42), "-42", "%d: -42")
assert_eq(string.format("%d", 2147483647), "2147483647", "%d: INT_MAX")
assert_eq(string.format("%d", -2147483648), "-2147483648", "%d: INT_MIN")

-- %i: alias for %d
assert_eq(string.format("%i", 42), "42", "%i: 42")
assert_eq(string.format("%i", -7), "-7", "%i: -7")

-- %d: width
assert_eq(string.format("%5d", 42), "   42", "%d: width 5")
assert_eq(string.format("%5d", -42), "  -42", "%d: width 5 neg")
assert_eq(string.format("%1d", 42), "42", "%d: width 1 no pad")

-- %d: left-justify
assert_eq(string.format("%-5d", 42), "42   ", "%d: left 42")
assert_eq(string.format("%-5d", -42), "-42  ", "%d: left -42")

-- %d: zero-pad
assert_eq(string.format("%05d", 42), "00042", "%d: zero-pad 42")
assert_eq(string.format("%05d", -42), "-0042", "%d: zero-pad -42")
assert_eq(string.format("%05d", 0), "00000", "%d: zero-pad 0")

-- %d: plus flag
assert_eq(string.format("%+d", 42), "+42", "%d: +42")
assert_eq(string.format("%+d", -42), "-42", "%d: + -42")
assert_eq(string.format("%+d", 0), "+0", "%d: +0")

-- %d: space flag
assert_eq(string.format("% d", 42), " 42", "%d: space 42")
assert_eq(string.format("% d", -42), "-42", "%d: space -42")
assert_eq(string.format("% d", 0), " 0", "%d: space 0")

-- %d: precision
assert_eq(string.format("%.5d", 42), "00042", "%d: prec5 42")
assert_eq(string.format("%.5d", -42), "-00042", "%d: prec5 -42")
assert_eq(string.format("%.0d", 0), "", "%d: prec0 0")
assert_eq(string.format("%.0d", 1), "1", "%d: prec0 1")
assert_eq(string.format("%.1d", 0), "0", "%d: prec1 0")

-- %d: width and precision
assert_eq(string.format("%8.5d", 42), "   00042", "%d: w8 p5 42")
assert_eq(string.format("%-8.5d", 42), "00042   ", "%d: left w8 p5 42")

-- %u: unsigned integers
assert_eq(string.format("%u", 0), "0", "%u: 0")
assert_eq(string.format("%u", 42), "42", "%u: 42")
assert_eq(string.format("%u", -1), "18446744073709551615", "%u: -1")
assert_eq(string.format("%u", -42), "18446744073709551574", "%u: -42")

-- %o: octal
assert_eq(string.format("%o", 0), "0", "%o: 0")
assert_eq(string.format("%o", 8), "10", "%o: 8")
assert_eq(string.format("%o", 255), "377", "%o: 255")
assert_eq(string.format("%o", -1), "1777777777777777777777", "%o: -1")

-- %o: alt flag
assert_eq(string.format("%#o", 0), "0", "%#o: 0")
assert_eq(string.format("%#o", 8), "010", "%#o: 8")
assert_eq(string.format("%#o", 255), "0377", "%#o: 255")

-- %x: hex lowercase
assert_eq(string.format("%x", 0), "0", "%x: 0")
assert_eq(string.format("%x", 255), "ff", "%x: 255")
assert_eq(string.format("%x", 4095), "fff", "%x: 4095")
assert_eq(string.format("%x", -1), "ffffffffffffffff", "%x: -1")

-- %X: hex uppercase
assert_eq(string.format("%X", 255), "FF", "%X: 255")
assert_eq(string.format("%X", -1), "FFFFFFFFFFFFFFFF", "%X: -1")

-- %x: alt flag
assert_eq(string.format("%#x", 0), "0", "%#x: 0")
assert_eq(string.format("%#x", 255), "0xff", "%#x: 255")
assert_eq(string.format("%#X", 255), "0XFF", "%#X: 255")

-- %x: width and zero-pad
assert_eq(string.format("%08x", 255), "000000ff", "%x: zero-pad 255")
assert_eq(string.format("%#08x", 255), "0x0000ff", "%#x: zero-pad 255")

-- %c: character
assert_eq(string.format("%c", 65), "A", "%c: 65")
assert_eq(string.format("%c", 97), "a", "%c: 97")
assert_eq(string.format("%c", 48), "0", "%c: 48")

-- %c: width
assert_eq(string.format("%3c", 65), "  A", "%c: width 3")
assert_eq(string.format("%-3c", 65), "A  ", "%c: left width 3")

-- %s: strings
assert_eq(string.format("%s", "hello"), "hello", "%s: hello")
assert_eq(string.format("%s", ""), "", "%s: empty")
assert_eq(string.format("%s %s", "hello", "world"), "hello world", "%s: two")

-- %s: width
assert_eq(string.format("%10s", "hello"), "     hello", "%s: width 10")
assert_eq(string.format("%-10s", "hello"), "hello     ", "%s: left width 10")

-- %s: precision truncates
assert_eq(string.format("%.3s", "hello"), "hel", "%s: prec3")
assert_eq(string.format("%.10s", "hello"), "hello", "%s: prec10")
assert_eq(string.format("%.0s", "hello"), "", "%s: prec0")

-- %s: width and precision
assert_eq(string.format("%10.3s", "hello"), "       hel", "%s: w10 p3")
assert_eq(string.format("%-10.3s", "hello"), "hel       ", "%s: left w10 p3")

-- %f: basic floats
assert_eq(string.format("%f", 0), "0.000000", "%f: 0")
assert_eq(string.format("%f", 1), "1.000000", "%f: 1")
assert_eq(string.format("%f", -1), "-1.000000", "%f: -1")
assert_eq(string.format("%f", 3.14), "3.140000", "%f: 3.14")
assert_eq(string.format("%f", 0.1), "0.100000", "%f: 0.1")

-- %f: precision
assert_eq(string.format("%.2f", 3.14159), "3.14", "%f: prec2")
assert_eq(string.format("%.0f", 3.14159), "3", "%f: prec0")
assert_eq(string.format("%.10f", 1.0), "1.0000000000", "%f: prec10")

-- %f: width and precision
assert_eq(string.format("%10.2f", 3.14), "      3.14", "%f: w10 p2")
assert_eq(string.format("%-10.2f", 3.14), "3.14      ", "%f: left w10 p2")
assert_eq(string.format("%010.2f", 3.14), "0000003.14", "%f: zero-pad w10 p2")

-- %f: sign flags
assert_eq(string.format("%+f", 3.14), "+3.140000", "%f: +3.14")
assert_eq(string.format("%+f", -3.14), "-3.140000", "%f: + -3.14")
assert_eq(string.format("% f", 3.14), " 3.140000", "%f: space 3.14")
assert_eq(string.format("% f", -3.14), "-3.140000", "%f: space -3.14")

-- %f: non-finite
assert_eq(string.format("%f", 1/0), "inf", "%f: inf")
assert_eq(string.format("%f", -1/0), "-inf", "%f: -inf")
assert_eq(string.format("%f", 0/0), "-nan", "%f: nan")
assert_eq(string.format("%+f", 1/0), "+inf", "%f: +inf")

-- %f: width with non-finite
assert_eq(string.format("%10f", 1/0), "       inf", "%f: w10 inf")
assert_eq(string.format("%-10f", 1/0), "inf       ", "%f: left w10 inf")

-- %e: basic
assert_eq(string.format("%e", 0), "0.000000e+00", "%e: 0")
assert_eq(string.format("%e", 1), "1.000000e+00", "%e: 1")
assert_eq(string.format("%e", 100), "1.000000e+02", "%e: 100")
assert_eq(string.format("%e", 0.001), "1.000000e-03", "%e: 0.001")
assert_eq(string.format("%e", -42), "-4.200000e+01", "%e: -42")

-- %E: uppercase
assert_eq(string.format("%E", 100), "1.000000E+02", "%E: 100")

-- %e: precision
assert_eq(string.format("%.2e", 100), "1.00e+02", "%e: prec2")
assert_eq(string.format("%.0e", 100), "1e+02", "%e: prec0")
assert_eq(string.format("%.14e", 1), "1.00000000000000e+00", "%e: prec14")

-- %e: non-finite
assert_eq(string.format("%e", 1/0), "inf", "%e: inf")
assert_eq(string.format("%e", -1/0), "-inf", "%e: -inf")
assert_eq(string.format("%e", 0/0), "-nan", "%e: nan")

-- %e: width and flags
assert_eq(string.format("%15e", 100), "   1.000000e+02", "%e: w15")
assert_eq(string.format("%-15e", 100), "1.000000e+02   ", "%e: left w15")
assert_eq(string.format("%+e", 100), "+1.000000e+02", "%e: +100")

-- %g: basic
assert_eq(string.format("%g", 0), "0", "%g: 0")
assert_eq(string.format("%g", 1), "1", "%g: 1")
assert_eq(string.format("%g", 100), "100", "%g: 100")
assert_eq(string.format("%g", 100000), "100000", "%g: 100000")
assert_eq(string.format("%g", 1000000), "1e+06", "%g: 1000000")
assert_eq(string.format("%g", 0.0001), "0.0001", "%g: 0.0001")
assert_eq(string.format("%g", 0.00001), "1e-05", "%g: 0.00001")
assert_eq(string.format("%g", -42), "-42", "%g: -42")

-- %G: uppercase
assert_eq(string.format("%G", 1e6), "1E+06", "%G: 1e6")
assert_eq(string.format("%G", 1e-5), "1E-05", "%G: 1e-5")

-- %g: precision
assert_eq(string.format("%.1g", 3.14), "3", "%g: prec1")
assert_eq(string.format("%.2g", 3.14), "3.1", "%g: prec2")
assert_eq(string.format("%.4g", 3.14159), "3.142", "%g: prec4")
assert_eq(string.format("%.0g", 3.14), "3", "%g: prec0")
assert_eq(string.format("%.10g", 1), "1", "%g: prec10 int")

-- %g: strips trailing zeros
assert_eq(string.format("%.6g", 1.0), "1", "%g: strip 1.0")
assert_eq(string.format("%.6g", 1.5), "1.5", "%g: strip 1.5")
assert_eq(string.format("%.6g", 1.50), "1.5", "%g: strip 1.50")
assert_eq(string.format("%.14g", 1.0), "1", "%g: strip prec14 1.0")
assert_eq(string.format("%.14g", 1.5), "1.5", "%g: strip prec14 1.5")

-- %g: alt flag keeps trailing zeros and dot
assert_eq(string.format("%#g", 1.0), "1.00000", "%#g: 1.0")
assert_eq(string.format("%#.2g", 1.0), "1.0", "%#g: prec2 1.0")
assert_eq(string.format("%#.4g", 100), "100.0", "%#g: prec4 100")

-- %g: non-finite
assert_eq(string.format("%g", 1/0), "inf", "%g: inf")
assert_eq(string.format("%g", -1/0), "-inf", "%g: -inf")
assert_eq(string.format("%g", 0/0), "-nan", "%g: nan")
assert_eq(string.format("%+g", 1/0), "+inf", "%g: +inf")

-- %g: width and flags
assert_eq(string.format("%10g", 42), "        42", "%g: w10 42")
assert_eq(string.format("%-10g", 42), "42        ", "%g: left w10 42")
assert_eq(string.format("%010g", 42), "0000000042", "%g: zero-pad w10 42")
assert_eq(string.format("%+g", 42), "+42", "%g: +42")
assert_eq(string.format("% g", 42), " 42", "%g: space 42")

-- %g: Lua 5.4 %.14g reference values
assert_eq(string.format("%.14g", 0.0), "0", "%.14g: 0.0")
assert_eq(string.format("%.14g", 1.0), "1", "%.14g: 1.0")
assert_eq(string.format("%.14g", 1/3), "0.33333333333333", "%.14g: 1/3")
assert_eq(string.format("%.14g", math.pi), "3.1415926535898", "%.14g: pi")
assert_eq(string.format("%.14g", 1e-10), "1e-10", "%.14g: 1e-10")
assert_eq(string.format("%.14g", 1e18), "1e+18", "%.14g: 1e18")
assert_eq(string.format("%.14g", 2^63), "9.2233720368548e+18", "%.14g: 2^63")
assert_eq(string.format("%.14g", 2^53), "9.007199254741e+15", "%.14g: 2^53")
assert_eq(string.format("%.14g", 1.7976931348623e+308), "1.7976931348623e+308", "%.14g: max")
assert_eq(string.format("%.14g", 5e-324), "4.9406564584125e-324", "%.14g: min subnormal")
assert_eq(string.format("%.14g", 0/0), "-nan", "%.14g: nan")
assert_eq(string.format("%.14g", 1/0), "inf", "%.14g: inf")
assert_eq(string.format("%.14g", -1/0), "-inf", "%.14g: -inf")

-- mixed: multiple specifiers
assert_eq(string.format("%d + %d = %d", 1, 2, 3), "1 + 2 = 3", "mixed: d+d=d")
assert_eq(string.format("%s is %d", "age", 42), "age is 42", "mixed: s is d")
assert_eq(string.format("[%05d] %s (%.2f)", 7, "test", 3.14), "[00007] test (3.14)", "mixed: complex")

-- mixed: no specifiers
assert_eq(string.format("hello world"), "hello world", "mixed: no spec")
assert_eq(string.format(""), "", "mixed: empty")

-- error: invalid specifier (Lua 5.4 says "invalid conversion", 5.5 may differ)
do
  local ok = pcall(string.format, "%z", 1)
  assert_eq(ok, false, "%z: should error")
end

-- error: trailing percent
do
  local ok = pcall(string.format, "abc%")
  assert_eq(ok, false, "trailing %%: should error")
end

-- %f: negative zero
assert_eq(string.format("%f", -0.0), "-0.000000", "%f: -0.0")
assert_eq(string.format("%e", -0.0), "-0.000000e+00", "%e: -0.0")
assert_eq(string.format("%g", -0.0), "-0", "%g: -0.0")

-- %f: large precision
do
  local s = string.format("%.20f", 1.0)
  assert_eq(string.find(s, "%.") ~= nil, true, "%f: large prec has dot")
  assert_eq(#s, 22, "%f: large prec length")
end

-- zero width is no-op
assert_eq(string.format("%0d", 42), "42", "%0d: no-op")

-- %a: basic hex floats
assert_eq(string.format("%a", 0), "0x0p+0", "%a: 0")
assert_eq(string.format("%a", 1), "0x1p+0", "%a: 1")
assert_eq(string.format("%a", -1), "-0x1p+0", "%a: -1")
assert_eq(string.format("%a", 2), "0x1p+1", "%a: 2")
assert_eq(string.format("%a", 0.5), "0x1p-1", "%a: 0.5")
assert_eq(string.format("%a", 1.5), "0x1.8p+0", "%a: 1.5")
assert_eq(string.format("%a", -0.0), "-0x0p+0", "%a: -0.0")

-- %A: uppercase
assert_eq(string.format("%A", 1.5), "0X1.8P+0", "%A: 1.5")
assert_eq(string.format("%A", 255), "0X1.FEP+7", "%A: 255")

-- %a: precision
assert_eq(string.format("%.0a", 1.5), "0x2p+0", "%a: prec0 1.5")
assert_eq(string.format("%.1a", 1.5), "0x1.8p+0", "%a: prec1 1.5")
assert_eq(string.format("%.4a", 1.5), "0x1.8000p+0", "%a: prec4 1.5")
assert_eq(string.format("%.4a", 1), "0x1.0000p+0", "%a: prec4 1")

-- %a: width and flags
assert_eq(string.format("%20a", 1.5), "            0x1.8p+0", "%a: w20 1.5")
assert_eq(string.format("%-20a", 1.5), "0x1.8p+0            ", "%a: left w20 1.5")
assert_eq(string.format("%+a", 1.5), "+0x1.8p+0", "%a: +1.5")
assert_eq(string.format("% a", 1.5), " 0x1.8p+0", "%a: space 1.5")

-- %a: non-finite
assert_eq(string.format("%a", 1/0), "inf", "%a: inf")
assert_eq(string.format("%a", -1/0), "-inf", "%a: -inf")
assert_eq(string.format("%a", 0/0), "-nan", "%a: nan")
assert_eq(string.format("%A", 1/0), "INF", "%A: inf")

-- %a: Math.PI
assert_eq(string.format("%a", math.pi), "0x1.921fb54442d18p+1", "%a: pi")

-- %a: 0.1
assert_eq(string.format("%a", 0.1), "0x1.999999999999ap-4", "%a: 0.1")

-- %q: nil and booleans
assert_eq(string.format("%q", nil), "nil", "%q: nil")
assert_eq(string.format("%q", true), "true", "%q: true")
assert_eq(string.format("%q", false), "false", "%q: false")

-- %q: integers
assert_eq(string.format("%q", 0), "0", "%q: 0")
assert_eq(string.format("%q", 1), "1", "%q: 1")
assert_eq(string.format("%q", -1), "-1", "%q: -1")
assert_eq(string.format("%q", 42), "42", "%q: 42")
assert_eq(string.format("%q", -42), "-42", "%q: -42")

-- %q: floats as hex
assert_eq(string.format("%q", 1.5), "0x1.8p+0", "%q: 1.5")
assert_eq(string.format("%q", 0.1), "0x1.999999999999ap-4", "%q: 0.1")
assert_eq(string.format("%q", math.pi), "0x1.921fb54442d18p+1", "%q: pi")
assert_eq(string.format("%q", -0.5), "-0x1p-1", "%q: -0.5")
assert_eq(string.format("%q", -0.0), "-0x0p+0", "%q: -0.0")

-- %q: non-finite numbers
assert_eq(string.format("%q", 0/0), "(0/0)", "%q: nan")
assert_eq(string.format("%q", 1/0), "1e9999", "%q: inf")
assert_eq(string.format("%q", -1/0), "-1e9999", "%q: -inf")

-- %q: simple strings
assert_eq(string.format("%q", "hello"), '"hello"', "%q: hello")
assert_eq(string.format("%q", ""), '""', "%q: empty")

-- %q: strings with special characters
assert_eq(string.format("%q", 'say "hi"'), '"say \\"hi\\""', '%q: quotes')
assert_eq(string.format("%q", "back\\slash"), '"back\\\\slash"', "%q: backslash")
assert_eq(string.format("%q", "line\nbreak"), '"line\\\nbreak"', "%q: newline")
assert_eq(string.format("%q", "cr\rreturn"), '"cr\\13return"', "%q: cr")
assert_eq(string.format("%q", "tab\there"), '"tab\\9here"', "%q: tab")

-- %q: Lua reference example
do
  local result = string.format("%q", 'a string with "quotes" and \n new line')
  assert_eq(result, '"a string with \\"quotes\\" and \\\n new line"', "%q: reference")
end

-- %q: mixed with other specifiers
assert_eq(
  string.format("name=%q age=%d", "Alice", 30),
  'name="Alice" age=30',
  "%q: mixed"
)
