import { assertEquals } from "@std/assert/equals";
import { assertThrows } from "@std/assert/throws";
import { luaFormat } from "./format.ts";

Deno.test("%%: literal percent", () => {
  assertEquals(luaFormat("%%"), "%");
  assertEquals(luaFormat("100%%"), "100%");
  assertEquals(luaFormat("%%%%"), "%%");
  assertEquals(luaFormat("a%%b%%c"), "a%b%c");
});

Deno.test("%d: basic integers", () => {
  assertEquals(luaFormat("%d", 0), "0");
  assertEquals(luaFormat("%d", 1), "1");
  assertEquals(luaFormat("%d", -1), "-1");
  assertEquals(luaFormat("%d", 42), "42");
  assertEquals(luaFormat("%d", -42), "-42");
  assertEquals(luaFormat("%d", 2147483647), "2147483647");
  assertEquals(luaFormat("%d", -2147483648), "-2147483648");
});

Deno.test("%i: alias for %d", () => {
  assertEquals(luaFormat("%i", 42), "42");
  assertEquals(luaFormat("%i", -7), "-7");
});

Deno.test("%d: width", () => {
  assertEquals(luaFormat("%5d", 42), "   42");
  assertEquals(luaFormat("%5d", -42), "  -42");
  assertEquals(luaFormat("%1d", 42), "42");
});

Deno.test("%d: left-justify", () => {
  assertEquals(luaFormat("%-5d", 42), "42   ");
  assertEquals(luaFormat("%-5d", -42), "-42  ");
});

Deno.test("%d: zero-pad", () => {
  assertEquals(luaFormat("%05d", 42), "00042");
  assertEquals(luaFormat("%05d", -42), "-0042");
  assertEquals(luaFormat("%05d", 0), "00000");
});

Deno.test("%d: plus flag", () => {
  assertEquals(luaFormat("%+d", 42), "+42");
  assertEquals(luaFormat("%+d", -42), "-42");
  assertEquals(luaFormat("%+d", 0), "+0");
});

Deno.test("%d: space flag", () => {
  assertEquals(luaFormat("% d", 42), " 42");
  assertEquals(luaFormat("% d", -42), "-42");
  assertEquals(luaFormat("% d", 0), " 0");
});

Deno.test("%d: precision", () => {
  assertEquals(luaFormat("%.5d", 42), "00042");
  assertEquals(luaFormat("%.5d", -42), "-00042");
  assertEquals(luaFormat("%.0d", 0), "");
  assertEquals(luaFormat("%.0d", 1), "1");
  assertEquals(luaFormat("%.1d", 0), "0");
});

Deno.test("%d: width and precision", () => {
  assertEquals(luaFormat("%8.5d", 42), "   00042");
  assertEquals(luaFormat("%-8.5d", 42), "00042   ");
});

Deno.test("%u: unsigned integers", () => {
  assertEquals(luaFormat("%u", 0), "0");
  assertEquals(luaFormat("%u", 42), "42");
  assertEquals(luaFormat("%u", -1), "18446744073709551615");
  assertEquals(luaFormat("%u", -42), "18446744073709551574");
});

Deno.test("%o: octal", () => {
  assertEquals(luaFormat("%o", 0), "0");
  assertEquals(luaFormat("%o", 8), "10");
  assertEquals(luaFormat("%o", 255), "377");
  assertEquals(luaFormat("%o", -1), "1777777777777777777777");
});

Deno.test("%o: alt flag", () => {
  assertEquals(luaFormat("%#o", 0), "0");
  assertEquals(luaFormat("%#o", 8), "010");
  assertEquals(luaFormat("%#o", 255), "0377");
});

Deno.test("%x: hex lowercase", () => {
  assertEquals(luaFormat("%x", 0), "0");
  assertEquals(luaFormat("%x", 255), "ff");
  assertEquals(luaFormat("%x", 4095), "fff");
  assertEquals(luaFormat("%x", -1), "ffffffffffffffff");
});

Deno.test("%X: hex uppercase", () => {
  assertEquals(luaFormat("%X", 255), "FF");
  assertEquals(luaFormat("%X", -1), "FFFFFFFFFFFFFFFF");
});

Deno.test("%x: alt flag", () => {
  assertEquals(luaFormat("%#x", 0), "0");
  assertEquals(luaFormat("%#x", 255), "0xff");
  assertEquals(luaFormat("%#X", 255), "0XFF");
});

Deno.test("%x: width and zero-pad", () => {
  assertEquals(luaFormat("%08x", 255), "000000ff");
  assertEquals(luaFormat("%#08x", 255), "0x0000ff");
});

Deno.test("%c: character", () => {
  assertEquals(luaFormat("%c", 65), "A");
  assertEquals(luaFormat("%c", 97), "a");
  assertEquals(luaFormat("%c", 48), "0");
});

Deno.test("%c: width", () => {
  assertEquals(luaFormat("%3c", 65), "  A");
  assertEquals(luaFormat("%-3c", 65), "A  ");
});

Deno.test("%s: strings", () => {
  assertEquals(luaFormat("%s", "hello"), "hello");
  assertEquals(luaFormat("%s", ""), "");
  assertEquals(luaFormat("%s %s", "hello", "world"), "hello world");
});

Deno.test("%s: width", () => {
  assertEquals(luaFormat("%10s", "hello"), "     hello");
  assertEquals(luaFormat("%-10s", "hello"), "hello     ");
});

Deno.test("%s: precision truncates", () => {
  assertEquals(luaFormat("%.3s", "hello"), "hel");
  assertEquals(luaFormat("%.10s", "hello"), "hello");
  assertEquals(luaFormat("%.0s", "hello"), "");
});

Deno.test("%s: width and precision", () => {
  assertEquals(luaFormat("%10.3s", "hello"), "       hel");
  assertEquals(luaFormat("%-10.3s", "hello"), "hel       ");
});

Deno.test("%f: basic floats", () => {
  assertEquals(luaFormat("%f", 0), "0.000000");
  assertEquals(luaFormat("%f", 1), "1.000000");
  assertEquals(luaFormat("%f", -1), "-1.000000");
  assertEquals(luaFormat("%f", 3.14), "3.140000");
  assertEquals(luaFormat("%f", 0.1), "0.100000");
});

Deno.test("%f: precision", () => {
  assertEquals(luaFormat("%.2f", 3.14159), "3.14");
  assertEquals(luaFormat("%.0f", 3.14159), "3");
  assertEquals(luaFormat("%.10f", 1.0), "1.0000000000");
});

Deno.test("%f: width and precision", () => {
  assertEquals(luaFormat("%10.2f", 3.14), "      3.14");
  assertEquals(luaFormat("%-10.2f", 3.14), "3.14      ");
  assertEquals(luaFormat("%010.2f", 3.14), "0000003.14");
});

Deno.test("%f: sign flags", () => {
  assertEquals(luaFormat("%+f", 3.14), "+3.140000");
  assertEquals(luaFormat("%+f", -3.14), "-3.140000");
  assertEquals(luaFormat("% f", 3.14), " 3.140000");
  assertEquals(luaFormat("% f", -3.14), "-3.140000");
});

Deno.test("%f: non-finite", () => {
  assertEquals(luaFormat("%f", Infinity), "inf");
  assertEquals(luaFormat("%f", -Infinity), "-inf");
  assertEquals(luaFormat("%f", NaN), "-nan");
  assertEquals(luaFormat("%+f", Infinity), "+inf");
});

Deno.test("%f: width with non-finite", () => {
  assertEquals(luaFormat("%10f", Infinity), "       inf");
  assertEquals(luaFormat("%-10f", Infinity), "inf       ");
});

Deno.test("%e: basic", () => {
  assertEquals(luaFormat("%e", 0), "0.000000e+00");
  assertEquals(luaFormat("%e", 1), "1.000000e+00");
  assertEquals(luaFormat("%e", 100), "1.000000e+02");
  assertEquals(luaFormat("%e", 0.001), "1.000000e-03");
  assertEquals(luaFormat("%e", -42), "-4.200000e+01");
});

Deno.test("%E: uppercase", () => {
  assertEquals(luaFormat("%E", 100), "1.000000E+02");
});

Deno.test("%e: precision", () => {
  assertEquals(luaFormat("%.2e", 100), "1.00e+02");
  assertEquals(luaFormat("%.0e", 100), "1e+02");
  assertEquals(luaFormat("%.14e", 1), "1.00000000000000e+00");
});

Deno.test("%e: non-finite", () => {
  assertEquals(luaFormat("%e", Infinity), "inf");
  assertEquals(luaFormat("%e", -Infinity), "-inf");
  assertEquals(luaFormat("%e", NaN), "-nan");
});

Deno.test("%e: width and flags", () => {
  assertEquals(luaFormat("%15e", 100), "   1.000000e+02");
  assertEquals(luaFormat("%-15e", 100), "1.000000e+02   ");
  assertEquals(luaFormat("%+e", 100), "+1.000000e+02");
});

Deno.test("%g: basic", () => {
  assertEquals(luaFormat("%g", 0), "0");
  assertEquals(luaFormat("%g", 1), "1");
  assertEquals(luaFormat("%g", 100), "100");
  assertEquals(luaFormat("%g", 100000), "100000");
  assertEquals(luaFormat("%g", 1000000), "1e+06");
  assertEquals(luaFormat("%g", 0.0001), "0.0001");
  assertEquals(luaFormat("%g", 0.00001), "1e-05");
  assertEquals(luaFormat("%g", -42), "-42");
});

Deno.test("%G: uppercase", () => {
  assertEquals(luaFormat("%G", 1e6), "1E+06");
  assertEquals(luaFormat("%G", 1e-5), "1E-05");
});

Deno.test("%g: precision", () => {
  assertEquals(luaFormat("%.1g", 3.14), "3");
  assertEquals(luaFormat("%.2g", 3.14), "3.1");
  assertEquals(luaFormat("%.4g", 3.14159), "3.142");
  assertEquals(luaFormat("%.0g", 3.14), "3");
  assertEquals(luaFormat("%.10g", 1), "1");
});

Deno.test("%g: strips trailing zeros", () => {
  assertEquals(luaFormat("%.6g", 1.0), "1");
  assertEquals(luaFormat("%.6g", 1.5), "1.5");
  assertEquals(luaFormat("%.6g", 1.50), "1.5");
  assertEquals(luaFormat("%.14g", 1.0), "1");
  assertEquals(luaFormat("%.14g", 1.5), "1.5");
});

Deno.test("%g: alt flag keeps trailing zeros and dot", () => {
  assertEquals(luaFormat("%#g", 1.0), "1.00000");
  assertEquals(luaFormat("%#.2g", 1.0), "1.0");
  assertEquals(luaFormat("%#.4g", 100), "100.0");
});

Deno.test("%g: non-finite", () => {
  assertEquals(luaFormat("%g", Infinity), "inf");
  assertEquals(luaFormat("%g", -Infinity), "-inf");
  assertEquals(luaFormat("%g", NaN), "-nan");
  assertEquals(luaFormat("%+g", Infinity), "+inf");
});

Deno.test("%g: width and flags", () => {
  assertEquals(luaFormat("%10g", 42), "        42");
  assertEquals(luaFormat("%-10g", 42), "42        ");
  assertEquals(luaFormat("%010g", 42), "0000000042");
  assertEquals(luaFormat("%+g", 42), "+42");
  assertEquals(luaFormat("% g", 42), " 42");
});

Deno.test("%g: Lua 5.4 %.14g reference values", () => {
  assertEquals(luaFormat("%.14g", 0.0), "0");
  assertEquals(luaFormat("%.14g", 1.0), "1");
  assertEquals(luaFormat("%.14g", 1 / 3), "0.33333333333333");
  assertEquals(luaFormat("%.14g", Math.PI), "3.1415926535898");
  assertEquals(luaFormat("%.14g", 1e-10), "1e-10");
  assertEquals(luaFormat("%.14g", 1e18), "1e+18");
  assertEquals(luaFormat("%.14g", 2 ** 63), "9.2233720368548e+18");
  assertEquals(luaFormat("%.14g", 2 ** 53), "9.007199254741e+15");
  assertEquals(luaFormat("%.14g", 1.7976931348623e+308), "1.7976931348623e+308");
  assertEquals(luaFormat("%.14g", 5e-324), "4.9406564584125e-324");
  assertEquals(luaFormat("%.14g", NaN), "-nan");
  assertEquals(luaFormat("%.14g", Infinity), "inf");
  assertEquals(luaFormat("%.14g", -Infinity), "-inf");
});

Deno.test("*: width from arg", () => {
  assertEquals(luaFormat("%*d", 5, 42), "   42");
  assertEquals(luaFormat("%*d", -5, 42), "42   ");
});

Deno.test("*: precision from arg", () => {
  assertEquals(luaFormat("%.*f", 2, 3.14159), "3.14");
  assertEquals(luaFormat("%.*s", 3, "hello"), "hel");
});

Deno.test("*: both from args", () => {
  assertEquals(luaFormat("%*.*f", 10, 2, 3.14), "      3.14");
});

Deno.test("mixed: multiple specifiers", () => {
  assertEquals(luaFormat("%d + %d = %d", 1, 2, 3), "1 + 2 = 3");
  assertEquals(luaFormat("%s is %d", "age", 42), "age is 42");
  assertEquals(luaFormat("[%05d] %s (%.2f)", 7, "test", 3.14), "[00007] test (3.14)");
});

Deno.test("mixed: no specifiers", () => {
  assertEquals(luaFormat("hello world"), "hello world");
  assertEquals(luaFormat(""), "");
});

Deno.test("error: invalid specifier", () => {
  assertThrows(() => luaFormat("%z", 1), Error, "invalid format specifier");
});

Deno.test("error: trailing percent", () => {
  assertThrows(() => luaFormat("abc%"), Error, "invalid format");
});

Deno.test("%f: negative zero", () => {
  assertEquals(luaFormat("%f", -0), "-0.000000");
  assertEquals(luaFormat("%e", -0), "-0.000000e+00");
  assertEquals(luaFormat("%g", -0), "-0");
});

Deno.test("%f: large precision", () => {
  const s = luaFormat("%.20f", 1.0);
  assertEquals(s.indexOf(".") !== -1, true);
  assertEquals(s.length, 22); // "1." + 20 digits
});

Deno.test("zero width is no-op", () => {
  assertEquals(luaFormat("%0d", 42), "42");
});
