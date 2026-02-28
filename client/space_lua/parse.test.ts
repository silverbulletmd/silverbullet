import { expect, test } from "vitest";
import { parse, parseExpressionString, stripLuaComments } from "./parse.ts";
import type { LuaNumberLiteral } from "./ast.ts";

test("Test Lua parser", () => {
  // Basic block test
  parse(`
        print("Hello, World!")
        print(10)
`);
  parse("");
  // Expression tests
  parse(
    `e(1, 1.2, -3.8, -4, #lst, true, false, nil, "string", "", "Hello there \x00", ...)`,
  );
  parse(`e([[hel]lo]], "Grinny face\\u{1F600}")`);
  parse(`e([=[Hello page [[index]] end scene]=], [[yo]])`);

  // console.log(
  //   JSON.stringify(
  parse(`e([==[Hello page [[index]] end scene]==], [==[yo]==])`),
    // null,
    // 2,
    //   ),
    // );
    console.log(
      JSON.stringify(
        parse(`e([==[Hello page [[bla]]
]==])`),
        null,
        2,
      ),
    );

  parse(`e(10 << 10, 10 >> 10, 10 & 10, 10 | 10, 10 ~ 10)`);

  parse(`e(true and false or true)`);
  parse(`e(a < 3 and b > 4 or b == 5 or c <= 6 and d >= 7 or a /= 8)`);
  parse(`e(a.b.c)`);
  parse(`e((1+2))`);

  // Use keywordy variables
  parse(`e(order, limit, where)`);

  // Table expressions
  parse(`e({})`);
  parse(`e({1, 2, 3, })`);
  parse(`e({1 ; 2 ; 3})`);
  parse(`e({a = 1, b = 2, c = 3})`);
  parse(`e({[3] = 1, [10 * 10] = "sup"})`);
  parse(`e(tbl.name)`);
  parse(`e(tbl["name" + 10])`);
  parse(`e(test().bla)`);

  // Function calls
  parse(`e(func(), func(1, 2, 3), a.b(), a.b.c:hello(), (a.b)(7))`);

  // Function expression
  parse(`e(function(a, b) test() end)`);
  parse(`e(function(a, b, ...) end)`);

  // Statements
  parse(`do end`);
  parse(`do print() end`);
  parse(`::hello::
        goto hello`);
  parse(`while true do print() end`);
  parse(`repeat print() until false`);
  parse(
    `if 1 == 2 then print() elseif 1 < 2 then print2() else print3() end`,
  );
  parse(`if true then print() end`);
  parse(`if true then print() else print2() end`);
  parse(`if true then print() elseif false then print2() end`);

  // For loops
  parse(`for i = 1, 10, 1 do print(i) end`);
  parse(`for i = 1, 10 do print(i) end`);
  parse(`for el in each({1, 2, 3}) do print(i) end`);
  parse(`for i, l in 1, pairs() do print(i) end`);

  // Function statements
  parse(`function a() end`);
  parse(`function a:b() end`);
  parse(`function a.b.c:d() end`);
  parse(`function a.b.c() end`);
  parse(`function hello(a, b) end`);
  parse(`function hello(a, b, ...) end`);
  parse(`local function hello() end`);

  // Assignments, local variables etc.
  parse(`a = 1`);
  parse(`a, b = 1, 2`);
  parse(`a.b.c = 1`);
  parse(`a["name"] = 1`);
  parse(`local a, b<const>`);
  parse(`local a = 1`);
  parse(`local a<const> = 4`);
  parse(`local a, b = 1, 2`);

  // Function calls
  parse(`a(1, 2, 3)`);
  parse(`print "Sup"`);
  parse(`e(1 + print "8")`);

  // Return statements
  parse(`return`);
  parse(`return 1`);
  parse(`return 1, 2, 3`);
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
  console.log(stripLuaComments(`e([==[
    --- Hello
  ]==])`));
});

test("Test query parsing", () => {
  parse(
    `_(query[[from p = index.tag("page") where p.name == "John" limit 10, 3]])`,
  );
  parse(`_(query[[from index.tag("page") select {name="hello", age=10}]])`);
  parse(
    `_(query[[from p = index.tag("page") order by p.lastModified desc, p.name]])`,
  );
  parse(`_(query[[from p = index.tag("page") order by p.lastModified]])`);
  // group by single key
  parse(
    `_(query[[from p = index.tag("page") group by p.category]])`,
  );
  // group by multiple keys
  parse(
    `_(query[[from p = index.tag("page") group by p.category, p.status]])`,
  );
  // group by + having
  parse(
    `_(query[[from p = index.tag("page") group by p.category having #group > 1]])`,
  );
  // group by + having + select
  parse(
    `_(query[[from p = index.tag("page") group by p.category, p.status having #group > 2 select { key = key, count = #group }]])`,
  );
});

test("Test numeric constant parsing", () => {
  // Examples from Lua 5.4 Reference Manual, except hexadecimal constants with fractional part
  expect((parseExpressionString(`3`) as LuaNumberLiteral).value).toEqual(3);
  expect((parseExpressionString(`345`) as LuaNumberLiteral).value).toEqual(345);
  expect((parseExpressionString(`0xff`) as LuaNumberLiteral).value).toEqual(0xff);
  expect((parseExpressionString(`0xBEBADA`) as LuaNumberLiteral).value).toEqual(0xBEBADA,
  );
  expect((parseExpressionString(`3.0`) as LuaNumberLiteral).value).toEqual(3.0);
  expect((parseExpressionString(`3.1416`) as LuaNumberLiteral).value).toEqual(3.1416,
  );
  expect((parseExpressionString(`314.16e-2`) as LuaNumberLiteral).value).toEqual(314.16e-2,
  );
  expect((parseExpressionString(`0.31416E1`) as LuaNumberLiteral).value).toEqual(0.31416E1,
  );
  expect((parseExpressionString(`34e1`) as LuaNumberLiteral).value).toEqual(34e1,
  );
});
