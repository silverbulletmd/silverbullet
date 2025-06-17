import { assertEquals } from "@std/assert";
import { cleanupJSON, deepClone, deepEqual } from "./json.ts";

Deno.test("JSON utils", () => {
  assertEquals(deepEqual({ a: 1 }, { a: 1 }), true);
  assertEquals(deepEqual({ a: null }, { a: null }), true);
  assertEquals(deepEqual({ a: {} }, { a: null }), false);
  assertEquals(deepEqual({ a: {} }, { a: undefined }), false);
  assertEquals(deepEqual({ a: null }, { a: {} }), false);
  assertEquals(cleanupJSON({ "a.b": 1 }), { a: { b: 1 } });
  assertEquals(cleanupJSON({ a: { "a.b": 1 } }), {
    a: { a: { b: 1 } },
  });
  assertEquals(cleanupJSON({ a: [{ "a.b": 1 }] }), {
    a: [{ a: { b: 1 } }],
  });

  assertEquals(cleanupJSON(new Date("2023-05-03T00:00:00Z")), "2023-05-03");
});

Deno.test("JSON utils - deepObjectMerge", () => {
  // Tests for deepClone
  const obj1 = { a: 1, b: { c: 2, d: [3, 4] }, e: new Date("2023-08-21") };
  const clone1 = deepClone(obj1);
  assertEquals(clone1, obj1);
  assertEquals(clone1 === obj1, false); // Ensuring deep clone, not shallow
  assertEquals(clone1.b === obj1.b, false); // Nested object should be different reference
  assertEquals(clone1.e === obj1.e, false); // Date object should be different reference

  const arrayTest = [1, 2, { a: 3, b: [4, 5] }];
  const cloneArray = deepClone(arrayTest);
  assertEquals(cloneArray, arrayTest);
  assertEquals(cloneArray === arrayTest, false); // Array itself should be different reference
  assertEquals(cloneArray[2] === arrayTest[2], false); // Nested object in array should be different reference

  const nullTest = { a: null, b: undefined, c: { d: null } };
  const cloneNullTest = deepClone(nullTest);
  assertEquals(cloneNullTest, nullTest);
  assertEquals(cloneNullTest === nullTest, false); // Ensure it's a deep clone
  assertEquals(cloneNullTest.c === nullTest.c, false); // Nested object should be different reference

  const dateTest = new Date();
  const cloneDateTest = deepClone(dateTest);
  assertEquals(cloneDateTest.getTime(), dateTest.getTime());
  assertEquals(cloneDateTest === dateTest, false); // Date instance should be different reference
});
