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
      where: parseExpressionString("x >= 2"),
    },
    rootEnv,
    LuaStackFrame.lostFrame,
  );
  // console.log(result);
  assert(result.length === 2);

  // Test limit
  const result2 = await collection.query(
    {
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
      offset: 1,
    },
    rootEnv,
    LuaStackFrame.lostFrame,
  );
  assert(result3.length === 2);
  assert(result3[0].x === 2);

  // Test order by
  const result4 = await collection.query(
    {
      orderBy: [{ expr: parseExpressionString("x"), desc: false }],
    },
    rootEnv,
    LuaStackFrame.lostFrame,
  );
  assert(result4.length === 3);
  assert(result4[0].x === 1);
  assert(result4[1].x === 2);
  assert(result4[2].x === 3);

  // Test order by desc
  const result5 = await collection.query(
    {
      orderBy: [{ expr: parseExpressionString("x"), desc: true }],
    },
    rootEnv,
    LuaStackFrame.lostFrame,
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
      orderBy: [
        { expr: parseExpressionString("lastName"), desc: false },
        { expr: parseExpressionString("firstName"), desc: true },
      ],
    },
    rootEnv,
    LuaStackFrame.lostFrame,
  );
  assertEquals(result6[0].firstName, "John");
  assertEquals(result6[0].lastName, "Doe");
  assertEquals(result6[1].firstName, "Jane");
  assertEquals(result6[1].lastName, "Doe");
  assertEquals(result6[2].firstName, "Bob");
  assertEquals(result6[2].lastName, "Johnson");
  assertEquals(result6[3].firstName, "Alice");
  assertEquals(result6[3].lastName, "Johnson");

  // Test select
  const result7 = await collection2.query(
    {
      select: [{ name: "firstName" }],
    },
    rootEnv,
    LuaStackFrame.lostFrame,
  );
  assertEquals(result7[0].firstName, "John");
  assertEquals(result7[0].lastName, undefined);

  // Test select with expression
  const result8 = await collection2.query(
    {
      select: [{
        name: "fullName",
        expr: parseExpressionString("firstName .. ' ' .. lastName"),
      }],
    },
    rootEnv,
    LuaStackFrame.lostFrame,
  );
  assertEquals(result8[0].fullName, "John Doe");
  assertEquals(result8[1].fullName, "Alice Johnson");
  assertEquals(result8[2].fullName, "Jane Doe");
  assertEquals(result8[3].fullName, "Bob Johnson");

  // Test select with native function
  const result9 = await collection2.query(
    {
      select: [{
        name: "fullName",
        expr: parseExpressionString("build_name(firstName, lastName)"),
      }],
    },
    rootEnv,
    LuaStackFrame.lostFrame,
  );
  assertEquals(result9[0].fullName, "John Doe");
  assertEquals(result9[1].fullName, "Alice Johnson");
  assertEquals(result9[2].fullName, "Jane Doe");
  assertEquals(result9[3].fullName, "Bob Johnson");
});
