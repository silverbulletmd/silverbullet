import { parseExpressionString } from "$common/space_lua/parse.ts";
import { ArrayQueryCollection } from "./query_collection.ts";
import {
  LuaEnv,
  LuaNativeJSFunction,
  LuaStackFrame,
} from "$common/space_lua/runtime.ts";
import { assert, assertEquals } from "@std/assert";

Deno.test("ArrayQueryCollection", async () => {
  const rootEnv = new LuaEnv();
  rootEnv.setLocal(
    "build_name",
    new LuaNativeJSFunction((a, b) => {
      return Promise.resolve(a + " " + b);
    }),
  );

  const collection = new ArrayQueryCollection([{ x: 1, y: 1 }, { x: 2, y: 2 }, {
    x: 3,
    y: 3,
  }]);
  const result = await collection.query(
    {
      objectVariable: "p",
      where: parseExpressionString("p.x >= 2"),
    },
    rootEnv,
    LuaStackFrame.lostFrame,
    {}, // Default collation configuration, since the config API is unavailable
  );
  // console.log(result);
  assert(result.length === 2);

  // Test limit
  const result2 = await collection.query(
    {
      objectVariable: "p",
      limit: 1,
    },
    rootEnv,
    LuaStackFrame.lostFrame,
  );
  assert(result2.length === 1);
  assert(result2[0].x === 1);

  // Test offset
  const result3 = await collection.query(
    {
      objectVariable: "p",
      offset: 1,
    },
    rootEnv,
    LuaStackFrame.lostFrame,
    {},
  );
  assert(result3.length === 2);
  assert(result3[0].x === 2);

  // Test order by
  const result4 = await collection.query(
    {
      objectVariable: "p",
      orderBy: [{ expr: parseExpressionString("p.x"), desc: false }],
    },
    rootEnv,
    LuaStackFrame.lostFrame,
    {},
  );
  assert(result4.length === 3);
  assert(result4[0].x === 1);
  assert(result4[1].x === 2);
  assert(result4[2].x === 3);

  // Test order by desc
  const result5 = await collection.query(
    {
      objectVariable: "p",
      orderBy: [{ expr: parseExpressionString("p.x"), desc: true }],
    },
    rootEnv,
    LuaStackFrame.lostFrame,
    {},
  );
  assert(result5.length === 3);
  assert(result5[0].x === 3);
  assert(result5[1].x === 2);
  assert(result5[2].x === 1);

  // Test order by multiple fields
  const collection2 = new ArrayQueryCollection([
    { firstName: "John", lastName: "Doe" },
    { firstName: "Alice", lastName: "Johnson" },
    { firstName: "Jane", lastName: "Doe" },
    { firstName: "Bob", lastName: "Johnson" },
  ]);
  const result6 = await collection2.query(
    {
      objectVariable: "p",
      orderBy: [
        { expr: parseExpressionString("p.lastName"), desc: false },
        { expr: parseExpressionString("p.firstName"), desc: true },
      ],
    },
    rootEnv,
    LuaStackFrame.lostFrame,
    {},
  );
  assertEquals(result6[0].firstName, "John");
  assertEquals(result6[0].lastName, "Doe");
  assertEquals(result6[1].firstName, "Jane");
  assertEquals(result6[1].lastName, "Doe");
  assertEquals(result6[2].firstName, "Bob");
  assertEquals(result6[2].lastName, "Johnson");
  assertEquals(result6[3].firstName, "Alice");
  assertEquals(result6[3].lastName, "Johnson");

  // Test select with expression
  const result8 = await collection2.query(
    {
      objectVariable: "p",
      select: parseExpressionString("p.firstName .. ' ' .. p.lastName"),
    },
    rootEnv,
    LuaStackFrame.lostFrame,
    {},
  );
  assertEquals(result8[0], "John Doe");
  assertEquals(result8[1], "Alice Johnson");
  assertEquals(result8[2], "Jane Doe");
  assertEquals(result8[3], "Bob Johnson");

  // Test select with native function and implicit object variable
  const result9 = await collection2.query(
    {
      select: parseExpressionString("build_name(firstName, lastName)"),
    },
    rootEnv,
    LuaStackFrame.lostFrame,
    {},
  );
  assertEquals(result9[0], "John Doe");
  assertEquals(result9[1], "Alice Johnson");
  assertEquals(result9[2], "Jane Doe");
  assertEquals(result9[3], "Bob Johnson");

  // Test distinct
  const collectionWithDuplicates = new ArrayQueryCollection([
    { category: "fruit", name: "apple" },
    { category: "vegetable", name: "carrot" },
    { category: "fruit", name: "banana" },
    { category: "fruit", name: "apple" }, // Duplicate
    { category: "vegetable", name: "spinach" },
    { category: "fruit", name: "banana" }, // Duplicate
  ]);

  // Test distinct with select
  const distinctResult = await collectionWithDuplicates.query(
    {
      objectVariable: "item",
      select: parseExpressionString("item.category"),
      distinct: true,
    },
    rootEnv,
    LuaStackFrame.lostFrame,
    {},
  );
  assertEquals(distinctResult.length, 2);
  assertEquals(distinctResult.includes("fruit"), true);
  assertEquals(distinctResult.includes("vegetable"), true);

  // Test distinct with objects
  const distinctObjectsResult = await collectionWithDuplicates.query(
    {
      objectVariable: "item",
      select: parseExpressionString(
        "{ category = item.category, name = item.name }",
      ),
      distinct: true,
    },
    rootEnv,
    LuaStackFrame.lostFrame,
    {},
  );
  assertEquals(distinctObjectsResult.length, 4);

  // Test string sorting (collation) with example from MDN
  const letterCollection = new ArrayQueryCollection([
    { letter: "Z" },
    { letter: "z" },
    { letter: "ä" },
    { letter: "a" },
  ]);

  // Default ordering by codepoint
  const resultCodepoint = await letterCollection.query(
    {
      objectVariable: "item",
      orderBy: [{ expr: parseExpressionString("item.letter"), desc: false }],
    },
    rootEnv,
    LuaStackFrame.lostFrame,
    { enabled: false },
  );
  assertEquals(resultCodepoint[0].letter, "Z");
  assertEquals(resultCodepoint[1].letter, "a");
  assertEquals(resultCodepoint[2].letter, "z");
  assertEquals(resultCodepoint[3].letter, "ä");

  // Defaults for German
  const resultGerman = await letterCollection.query(
    {
      objectVariable: "item",
      orderBy: [{ expr: parseExpressionString("item.letter"), desc: false }],
    },
    rootEnv,
    LuaStackFrame.lostFrame,
    { enabled: true, locale: "de" },
  );
  assertEquals(resultGerman[0].letter, "a");
  assertEquals(resultGerman[1].letter, "ä");
  assertEquals(resultGerman[2].letter, "z");
  assertEquals(resultGerman[3].letter, "Z");

  // Defaults for Swedish
  const resultSwedish = await letterCollection.query(
    {
      objectVariable: "item",
      orderBy: [{ expr: parseExpressionString("item.letter"), desc: false }],
    },
    rootEnv,
    LuaStackFrame.lostFrame,
    { enabled: true, locale: "sv" },
  );
  assertEquals(resultSwedish[0].letter, "a");
  assertEquals(resultSwedish[1].letter, "z");
  assertEquals(resultSwedish[2].letter, "Z");
  assertEquals(resultSwedish[3].letter, "ä");

  // Uppercase first
  const resultUpper = await letterCollection.query(
    {
      objectVariable: "item",
      orderBy: [{ expr: parseExpressionString("item.letter"), desc: false }],
    },
    rootEnv,
    LuaStackFrame.lostFrame,
    { enabled: true, locale: "de", options: { caseFirst: "upper" } },
  );
  assertEquals(resultUpper[0].letter, "a");
  assertEquals(resultUpper[1].letter, "ä");
  assertEquals(resultUpper[2].letter, "Z");
  assertEquals(resultUpper[3].letter, "z");
});
