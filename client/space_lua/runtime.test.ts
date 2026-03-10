import { expect, test } from "vitest";
import {
  jsToLuaValue,
  luaLen,
  LuaMultiRes,
  LuaStackFrame,
  luaToString,
} from "./runtime.ts";

test("Test Lua Rutime", async () => {
  // Test LuaMultires
  expect(new LuaMultiRes([]).flatten().values).toEqual([]);
  expect(new LuaMultiRes([1, 2, 3]).flatten().values).toEqual([1, 2, 3]);
  expect(new LuaMultiRes([1, new LuaMultiRes([2, 3])]).flatten().values).toEqual([
    1,
    2,
    3,
  ]);

  // Test JavaScript to Lua conversion
  expect(jsToLuaValue(1)).toEqual(1);
  expect(jsToLuaValue("hello")).toEqual("hello");
  // Arrays
  let luaVal = jsToLuaValue([1, 2, 3]);
  expect(luaLen(luaVal)).toEqual(3);
  expect(luaVal.get(1)).toEqual(1);
  // Objects
  luaVal = jsToLuaValue({ name: "Pete", age: 10 });
  expect(luaVal.get("name")).toEqual("Pete");
  expect(luaVal.get("age")).toEqual(10);
  // Nested objects
  luaVal = jsToLuaValue({ name: "Pete", list: [1, 2, 3] });
  expect(luaVal.get("name")).toEqual("Pete");
  expect(luaLen(luaVal.get("list"))).toEqual(3);
  expect(luaVal.get("list").get(2)).toEqual(2);
  luaVal = jsToLuaValue([{ name: "Pete" }, { name: "John" }]);
  expect(luaLen(luaVal)).toEqual(2);
  expect(luaVal.get(1).get("name")).toEqual("Pete");
  expect(luaVal.get(2).get("name")).toEqual("John");
  // Functions in objects
  luaVal = jsToLuaValue({ name: "Pete", first: (l: any[]) => l[0] });
  expect(luaVal.get("first").call(LuaStackFrame.lostFrame, [1, 2, 3])).toEqual(1);

  // Test luaToString
  expect(await luaToString(new Promise((resolve) => resolve(1)))).toEqual("1");
  expect(await luaToString({ a: 1 })).toEqual("{a = 1}");
  expect(await luaToString([{ a: 1 }])).toEqual("{{a = 1}}");
  // Ensure simple cases are not returning promises
  expect(luaToString(10)).toEqual("10");
  // Test circular references
  const circular: any = {};
  circular.self = circular;
  expect(await luaToString(circular)).toEqual("{self = <circular reference>}");
});
