import { expect, test } from "vitest";
import {
  parseBlock,
  parseExpressionString,
  stripLuaComments,
} from "./parse.ts";
import type { LuaNumberLiteral } from "./ast.ts";

test("Test Lua parser", () => {
  // Basic block test
  parseBlock(`
        print("Hello, World!")
        print(10)
`);
  parseBlock("");
  // Expression tests
  parseBlock(
    `e(1, 1.2, -3.8, -4, #lst, true, false, nil, "string", "", "Hello there \x00", ...)`,
  );
  parseBlock(`e([[hel]lo]], "Grinny face\\u{1F600}")`);
  parseBlock(`e([=[Hello page [[index]] end scene]=], [[yo]])`);

  parseBlock(`e([==[Hello page [[index]] end scene]==], [==[yo]==])`);
  console.log(
    JSON.stringify(
      parseBlock(`e([==[Hello page [[bla]]
]==])`),
      null,
      2,
    ),
  );

  parseBlock(`e(10 << 10, 10 >> 10, 10 & 10, 10 | 10, 10 ~ 10)`);

  parseBlock(`e(true and false or true)`);
  parseBlock(`e(a < 3 and b > 4 or b == 5 or c <= 6 and d >= 7 or a /= 8)`);
  parseBlock(`e(a.b.c)`);
  parseBlock(`e((1+2))`);

  // Use keywordy variables
  parseBlock(`e(order, limit, where)`);

  // Table expressions
  parseBlock(`e({})`);
  parseBlock(`e({1, 2, 3, })`);
  parseBlock(`e({1 ; 2 ; 3})`);
  parseBlock(`e({a = 1, b = 2, c = 3})`);
  parseBlock(`e({[3] = 1, [10 * 10] = "sup"})`);
  parseBlock(`e(tbl.name)`);
  parseBlock(`e(tbl["name" + 10])`);
  parseBlock(`e(test().bla)`);

  // Function calls
  parseBlock(`e(func(), func(1, 2, 3), a.b(), a.b.c:hello(), (a.b)(7))`);

  // Function expression
  parseBlock(`e(function(a, b) test() end)`);
  parseBlock(`e(function(a, b, ...) end)`);

  // Statements
  parseBlock(`do end`);
  parseBlock(`do print() end`);
  parseBlock(`::hello::
        goto hello`);
  parseBlock(`while true do print() end`);
  parseBlock(`repeat print() until false`);
  parseBlock(
    `if 1 == 2 then print() elseif 1 < 2 then print2() else print3() end`,
  );
  parseBlock(`if true then print() end`);
  parseBlock(`if true then print() else print2() end`);
  parseBlock(`if true then print() elseif false then print2() end`);

  // For loops
  parseBlock(`for i = 1, 10, 1 do print(i) end`);
  parseBlock(`for i = 1, 10 do print(i) end`);
  parseBlock(`for el in each({1, 2, 3}) do print(i) end`);
  parseBlock(`for i, l in 1, pairs() do print(i) end`);

  // Function statements
  parseBlock(`function a() end`);
  parseBlock(`function a:b() end`);
  parseBlock(`function a.b.c:d() end`);
  parseBlock(`function a.b.c() end`);
  parseBlock(`function hello(a, b) end`);
  parseBlock(`function hello(a, b, ...) end`);
  parseBlock(`local function hello() end`);

  // Assignments, local variables etc.
  parseBlock(`a = 1`);
  parseBlock(`a, b = 1, 2`);
  parseBlock(`a.b.c = 1`);
  parseBlock(`a["name"] = 1`);
  parseBlock(`local a, b<const>`);
  parseBlock(`local a = 1`);
  parseBlock(`local a<const> = 4`);
  parseBlock(`local a, b = 1, 2`);

  // Function calls
  parseBlock(`a(1, 2, 3)`);
  parseBlock(`print "Sup"`);
  parseBlock(`e(1 + print "8")`);

  // Return statements
  parseBlock(`return`);
  parseBlock(`return 1`);
  parseBlock(`return 1, 2, 3`);
});

test("Test comment handling", () => {
  const code = `
-- Single line comment
--[[ Multi
line
comment ]]
f([[
hello
-- yo
]])`;
  const code2 = stripLuaComments(code);
  expect(code2.length).toEqual(code.length);
  console.log(code2);
  console.log(
    stripLuaComments(`e([==[
    --- Hello
  ]==])`),
  );
});

test("Test query parsing", () => {
  parseBlock(
    `_(query[[from p = index.tag("page") where p.name == "John" limit 10, 3]])`,
  );
  parseBlock(
    `_(query[[from index.tag("page") select {name="hello", age=10}]])`,
  );
  parseBlock(
    `_(query[[from p = index.tag("page") order by p.lastModified desc, p.name]])`,
  );
  parseBlock(`_(query[[from p = index.tag("page") order by p.lastModified]])`);
  // group by single key
  parseBlock(`_(query[[from p = index.tag("page") group by p.category]])`);
  // group by multiple keys
  parseBlock(
    `_(query[[from p = index.tag("page") group by p.category, p.status]])`,
  );
  // group by + having
  parseBlock(
    `_(query[[from p = index.tag("page") group by p.category having #group > 1]])`,
  );
  // group by + having + select
  parseBlock(
    `_(query[[from p = index.tag("page") group by p.category, p.status having #group > 2 select { key = key, count = #group }]])`,
  );
});

test("Test numeric constant parsing", () => {
  // Examples from Lua 5.4 Reference Manual, except hexadecimal constants with fractional part
  expect((parseExpressionString(`3`) as LuaNumberLiteral).value).toEqual(3);
  expect((parseExpressionString(`345`) as LuaNumberLiteral).value).toEqual(345);
  expect((parseExpressionString(`0xff`) as LuaNumberLiteral).value).toEqual(
    0xff,
  );
  expect((parseExpressionString(`0xBEBADA`) as LuaNumberLiteral).value).toEqual(
    0xbebada,
  );
  expect((parseExpressionString(`3.0`) as LuaNumberLiteral).value).toEqual(3.0);
  expect((parseExpressionString(`3.1416`) as LuaNumberLiteral).value) // biome-ignore lint/suspicious/noApproximativeNumericConstant: testing exact value 3.1416, not Math.PI
    .toEqual(3.1416);
  expect(
    (parseExpressionString(`314.16e-2`) as LuaNumberLiteral).value,
  ).toEqual(314.16e-2);
  expect(
    (parseExpressionString(`0.31416E1`) as LuaNumberLiteral).value,
  ).toEqual(0.31416e1);
  expect((parseExpressionString(`34e1`) as LuaNumberLiteral).value).toEqual(
    34e1,
  );
});
