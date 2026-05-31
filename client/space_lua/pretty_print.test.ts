import { expect, test } from "vitest";
import { parseBlock, parseExpressionString } from "./parse.ts";
import { prettyPrintBlock, prettyPrintExpression } from "./pretty_print.ts";
import type { PrintOptions } from "./pretty_print.ts";

function fmtExpr(code: string, opts?: PrintOptions): string {
  return prettyPrintExpression(parseExpressionString(code), opts);
}
function fmtBlock(code: string, opts?: PrintOptions): string {
  return prettyPrintBlock(parseBlock(code), opts);
}

test("literals", () => {
  expect(fmtExpr("nil")).toBe("nil");
  expect(fmtExpr("true")).toBe("true");
  expect(fmtExpr("false")).toBe("false");
  expect(fmtExpr("42")).toBe("42");
  expect(fmtExpr("3.5")).toBe("3.5");
  expect(fmtExpr('"hi"')).toBe('"hi"');
});

test("string re-quoting and escaping", () => {
  expect(fmtExpr(`'hi'`)).toBe('"hi"');
  expect(fmtExpr(`'say "hi"'`)).toBe('"say \\"hi\\""');
  expect(fmtExpr(`"a\\nb"`)).toBe('"a\\nb"');
  expect(fmtExpr(`'x'`, { quote: "single" })).toBe("'x'");
});

test("variable and access expressions", () => {
  expect(fmtExpr("foo")).toBe("foo");
  expect(fmtExpr("a.b.c")).toBe("a.b.c");
  expect(fmtExpr("t[1]")).toBe("t[1]");
  expect(fmtExpr('t["k"]')).toBe('t["k"]');
  // the parser drops redundant parens around a bare variable
  expect(fmtExpr("(a)")).toBe("a");
});

test("binary operators with spacing", () => {
  expect(fmtExpr("1+2")).toBe("1 + 2");
  expect(fmtExpr("a..b")).toBe("a .. b");
  expect(fmtExpr("a and b or c")).toBe("a and b or c");
  expect(fmtExpr("a==b")).toBe("a == b");
});

test("unary operators", () => {
  expect(fmtExpr("not x")).toBe("not x");
  expect(fmtExpr("-x")).toBe("-x");
  expect(fmtExpr("#t")).toBe("#t");
  expect(fmtExpr("~x")).toBe("~x");
});

test("precedence parenthesization preserves meaning", () => {
  expect(fmtExpr("(1+2)*3")).toBe("(1 + 2) * 3");
  expect(fmtExpr("1+2*3")).toBe("1 + 2 * 3");
  expect(fmtExpr("(a or b) and c")).toBe("(a or b) and c");
  expect(fmtExpr("a-(b-c)")).toBe("a - (b - c)");
  expect(fmtExpr("-x^2")).toBe("-x ^ 2");
  expect(fmtExpr("(-x)^2")).toBe("(-x) ^ 2");
});

test("tables: empty and single field inline", () => {
  expect(fmtExpr("{}")).toBe("{}");
  expect(fmtExpr("{a=1}")).toBe("{a = 1}");
  expect(fmtExpr("{42}")).toBe("{42}");
  expect(fmtExpr('{["a b"]=1}')).toBe('{["a b"] = 1}');
});

test("tables: 2+ fields break multiline with trailing comma", () => {
  expect(fmtExpr("{a=1,b=2}")).toBe(`{
  a = 1,
  b = 2,
}`);
  expect(fmtExpr("{1,2,3}")).toBe(`{
  1,
  2,
  3,
}`);
});

test("tables: trailingComma option off", () => {
  expect(fmtExpr("{a=1,b=2}", { trailingComma: false })).toBe(`{
  a = 1,
  b = 2
}`);
});

test("function definitions", () => {
  expect(fmtExpr("function() end")).toBe("function() end");
  expect(fmtExpr("function(a,b) return a end")).toBe(`function(a, b)
  return a
end`);
});

test("function calls and sugar", () => {
  expect(fmtExpr("f(1, 2)")).toBe("f(1, 2)");
  expect(fmtExpr("obj:m(1)")).toBe("obj:m(1)");
  expect(fmtExpr('f "x"')).toBe('f "x"');
  expect(fmtExpr('f("x")')).toBe('f "x"');
  expect(fmtExpr("f {a=1,b=2}")).toBe(`f {
  a = 1,
  b = 2,
}`);
});

test("simple statements", () => {
  expect(fmtBlock("local x = 1")).toBe("local x = 1");
  expect(fmtBlock("local a, b = 1, 2")).toBe("local a, b = 1, 2");
  expect(fmtBlock("local x <const> = 1")).toBe("local x <const> = 1");
  expect(fmtBlock("x = 1")).toBe("x = 1");
  expect(fmtBlock("a, b = 1, 2")).toBe("a, b = 1, 2");
  expect(fmtBlock("print(1)")).toBe("print(1)");
  expect(fmtBlock("return 1, 2")).toBe("return 1, 2");
  expect(fmtBlock("return")).toBe("return");
  expect(fmtBlock("do return end")).toBe(`do
  return
end`);
});

test("multi-statement block, one per line", () => {
  expect(fmtBlock("local x = 1\nlocal y = 2\nreturn x + y")).toBe(`local x = 1
local y = 2
return x + y`);
});

test("goto, label, break", () => {
  expect(fmtBlock("::top::")).toBe("::top::");
  expect(fmtBlock("goto done\n::done::")).toBe(`goto done
::done::`);
  expect(fmtBlock("while true do break end")).toBe(`while true do
  break
end`);
});

test("if / elseif / else", () => {
  expect(fmtBlock("if a then return 1 end")).toBe(`if a then
  return 1
end`);
  expect(
    fmtBlock("if a then return 1 elseif b then return 2 else return 3 end"),
  ).toBe(`if a then
  return 1
elseif b then
  return 2
else
  return 3
end`);
});

test("while / repeat", () => {
  expect(fmtBlock("while a do f() end")).toBe(`while a do
  f()
end`);
  expect(fmtBlock("repeat f() until a")).toBe(`repeat
  f()
until a`);
});

test("numeric and generic for", () => {
  expect(fmtBlock("for i=1,10 do f() end")).toBe(`for i = 1, 10 do
  f()
end`);
  expect(fmtBlock("for i=1,10,2 do f() end")).toBe(`for i = 1, 10, 2 do
  f()
end`);
  expect(fmtBlock("for k,v in pairs(t) do f() end")).toBe(`for k, v in pairs(t) do
  f()
end`);
});

test("function statements", () => {
  expect(fmtBlock("function a.b:m(x) return x end")).toBe(`function a.b:m(x)
  return x
end`);
  expect(fmtBlock("local function g() end")).toBe("local function g() end");
});

test("blank line between definitions", () => {
  expect(fmtBlock("function a() end\nfunction b() end\nlocal x = 1"))
    .toBe(`function a() end

function b() end

local x = 1`);
});

test("query expression", () => {
  const code =
    'query[[from p = index.pages() where p.tag == "x" order by p.name limit 5]]';
  expect(fmtExpr(code)).toBe(`query[[
  from p = index.pages()
  where p.tag == "x"
  order by p.name
  limit 5
]]`);
});

test("query order by direction", () => {
  const code = "query[[from p = t order by p.n desc]]";
  expect(fmtExpr(code)).toBe(`query[[
  from p = t
  order by p.n desc
]]`);
});

test("idempotency: print(parse(print(parse(x)))) === print(parse(x))", () => {
  const samples = [
    `local x = 1
return x + 2`,
    `config.define("a", {
  type = "object",
  properties = {
    x = true,
    y = false,
  },
})`,
    `function f(a, b)
  if a then
    return b
  end
end`,
    `for i = 1, 10 do
  print(i)
end`,
    "local t = {a = 1, b = {c = 2, d = 3}}",
  ];
  for (const code of samples) {
    const once = prettyPrintBlock(parseBlock(code));
    const twice = prettyPrintBlock(parseBlock(once));
    expect(twice).toBe(once);
  }
});
