import { expect, test } from "vitest";
import {
  isInsideLuaDirective,
  scanLuaDirectiveEnd,
  unescapeTableCellPipes,
} from "./directive_scan.ts";

const end = (s: string) => scanLuaDirectiveEnd(s, s.indexOf("${"));

test.each([
  ["${1+1} tail", "${1+1}"],
  ['${"}"} tail', '${"}"}'],
  ['${"{"} tail', '${"{"}'],
  ["${'a\\'}'} tail", "${'a\\'}'}"],
  ["${[[a}b]]} tail", "${[[a}b]]}"],
  ["${[==[x]]}]==]} tail", "${[==[x]]}]==]}"],
  ["${ {1,2,3} } tail", "${ {1,2,3} }"],
  ["${f({a = {b = 1}})} tail", "${f({a = {b = 1}})}"],
  ["${1 --[[ } ]] + 1} tail", "${1 --[[ } ]] + 1}"],
  [
    '${query[[from p = x select {a = "[[" .. p.name .. "]]"}]]} tail',
    '${query[[from p = x select {a = "[[" .. p.name .. "]]"}]]}',
  ],
  [
    '${query [[from p = x where p.n == "}" ]]} tail',
    '${query [[from p = x where p.n == "}" ]]}',
  ],
  // Not valid Lua: falls back to counting braces, as the parser always did
  ['${"} tail', '${"}'],
  ["${[[a} tail", "${[[a}"],
])("finds the end of %s", (input, directive) => {
  expect(input.slice(input.indexOf("${"), end(input))).toBe(directive);
});

test.each([["${1+1"], ["${f({)"], ["$x"], ["{1}"]])(
  "rejects unbalanced or non-directive %s",
  (input) => {
    expect(scanLuaDirectiveEnd(input, 0)).toBe(-1);
  },
);

test.each([
  ['${widget.markdown(" all is good|)}', true],
  ['${widget.markdown("|', true],
  ["${1+1|", true],
  ['${"a"} and |', false],
  ['text ${"a"} ${f("x|")}', true],
  ["no directive |", false],
])("isInsideLuaDirective(%s) is %s", (input, expected) => {
  const offset = input.indexOf("|");
  expect(isInsideLuaDirective(input.replace("|", ""), offset)).toBe(expected);
});

test("unescapes table-cell pipes", () => {
  expect(unescapeTableCellPipes('"a\\|b"')).toBe('"a|b"');
  expect(unescapeTableCellPipes("x")).toBe("x");
});
