import { expect, test } from "vitest";
import { parseExpressionString } from "./parse.ts";
import { ArrayQueryCollection } from "./query_collection.ts";
import { LuaEnv, LuaNativeJSFunction, LuaStackFrame } from "./runtime.ts";

test("ArrayQueryCollection", async () => {
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
  expect(result.length === 2).toBeTruthy();

  // Test limit
  const result2 = await collection.query(
    {
      objectVariable: "p",
      limit: 1,
    },
    rootEnv,
    LuaStackFrame.lostFrame,
  );
  expect(result2.length === 1).toBeTruthy();
  expect(result2[0].x === 1).toBeTruthy();

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
  expect(result3.length === 2).toBeTruthy();
  expect(result3[0].x === 2).toBeTruthy();

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
  expect(result4.length === 3).toBeTruthy();
  expect(result4[0].x === 1).toBeTruthy();
  expect(result4[1].x === 2).toBeTruthy();
  expect(result4[2].x === 3).toBeTruthy();

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
  expect(result5.length === 3).toBeTruthy();
  expect(result5[0].x === 3).toBeTruthy();
  expect(result5[1].x === 2).toBeTruthy();
  expect(result5[2].x === 1).toBeTruthy();

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
  expect(result6[0].firstName).toEqual("John");
  expect(result6[0].lastName).toEqual("Doe");
  expect(result6[1].firstName).toEqual("Jane");
  expect(result6[1].lastName).toEqual("Doe");
  expect(result6[2].firstName).toEqual("Bob");
  expect(result6[2].lastName).toEqual("Johnson");
  expect(result6[3].firstName).toEqual("Alice");
  expect(result6[3].lastName).toEqual("Johnson");

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
  expect(result8[0]).toEqual("John Doe");
  expect(result8[1]).toEqual("Alice Johnson");
  expect(result8[2]).toEqual("Jane Doe");
  expect(result8[3]).toEqual("Bob Johnson");

  // Test select with native function and implicit object variable
  const result9 = await collection2.query(
    {
      select: parseExpressionString("build_name(firstName, lastName)"),
    },
    rootEnv,
    LuaStackFrame.lostFrame,
    {},
  );
  expect(result9[0]).toEqual("John Doe");
  expect(result9[1]).toEqual("Alice Johnson");
  expect(result9[2]).toEqual("Jane Doe");
  expect(result9[3]).toEqual("Bob Johnson");

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
  expect(distinctResult.length).toEqual(2);
  expect(distinctResult.includes("fruit")).toEqual(true);
  expect(distinctResult.includes("vegetable")).toEqual(true);

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
  expect(distinctObjectsResult.length).toEqual(4);

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
  expect(resultCodepoint[0].letter).toEqual("Z");
  expect(resultCodepoint[1].letter).toEqual("a");
  expect(resultCodepoint[2].letter).toEqual("z");
  expect(resultCodepoint[3].letter).toEqual("ä");

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
  expect(resultGerman[0].letter).toEqual("a");
  expect(resultGerman[1].letter).toEqual("ä");
  expect(resultGerman[2].letter).toEqual("z");
  expect(resultGerman[3].letter).toEqual("Z");

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
  expect(resultSwedish[0].letter).toEqual("a");
  expect(resultSwedish[1].letter).toEqual("z");
  expect(resultSwedish[2].letter).toEqual("Z");
  expect(resultSwedish[3].letter).toEqual("ä");

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
  expect(resultUpper[0].letter).toEqual("a");
  expect(resultUpper[1].letter).toEqual("ä");
  expect(resultUpper[2].letter).toEqual("Z");
  expect(resultUpper[3].letter).toEqual("z");
});
