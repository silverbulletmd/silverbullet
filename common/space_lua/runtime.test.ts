import { assertEquals } from "@std/assert/equals";
import {
  jsToLuaValue,
  luaLen,
  LuaMultiRes,
  LuaStackFrame,
  luaToString,
} from "$common/space_lua/runtime.ts";

Deno.test("Test Lua Rutime", async () => {
  // Test LuaMultires
  assertEquals(new LuaMultiRes([]).flatten().values, []);
  assertEquals(new LuaMultiRes([1, 2, 3]).flatten().values, [1, 2, 3]);
  assertEquals(
    new LuaMultiRes([1, new LuaMultiRes([2, 3])]).flatten().values,
    [
      1,
      2,
      3,
    ],
  );

  // Test JavaScript to Lua conversion
  assertEquals(jsToLuaValue(1), 1);
  assertEquals(jsToLuaValue("hello"), "hello");
  // Arrays
  let luaVal = jsToLuaValue([1, 2, 3]);
  assertEquals(luaLen(luaVal), 3);
  assertEquals(luaVal.get(1), 1);
  // Objects
  luaVal = jsToLuaValue({ name: "Pete", age: 10 });
  assertEquals(luaVal.get("name"), "Pete");
  assertEquals(luaVal.get("age"), 10);
  // Nested objects
  luaVal = jsToLuaValue({ name: "Pete", list: [1, 2, 3] });
  assertEquals(luaVal.get("name"), "Pete");
  assertEquals(luaLen(luaVal.get("list")), 3);
  assertEquals(luaVal.get("list").get(2), 2);
  luaVal = jsToLuaValue([{ name: "Pete" }, { name: "John" }]);
  assertEquals(luaLen(luaVal), 2);
  assertEquals(luaVal.get(1).get("name"), "Pete");
  assertEquals(luaVal.get(2).get("name"), "John");
  // Functions in objects
  luaVal = jsToLuaValue({ name: "Pete", first: (l: any[]) => l[0] });
  assertEquals(luaVal.get("first").call(LuaStackFrame.lostFrame, [1, 2, 3]), 1);

  // Test luaToString
  assertEquals(await luaToString(new Promise((resolve) => resolve(1))), "1");
  assertEquals(await luaToString({ a: 1 }), "{a = 1}");
  assertEquals(await luaToString([{ a: 1 }]), "{{a = 1}}");
  // Ensure simple cases are not returning promises
  assertEquals(luaToString(10), "10");
});
