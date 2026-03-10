import { expect, test } from "vitest";
import { cleanupJSON, deepClone, deepEqual } from "./json.ts";

test("JSON utils", () => {
  expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
  expect(deepEqual({ a: null }, { a: null })).toBe(true);
  expect(deepEqual({ a: {} }, { a: null })).toBe(false);
  expect(deepEqual({ a: {} }, { a: undefined })).toBe(false);
  expect(deepEqual({ a: null }, { a: {} })).toBe(false);
  expect(cleanupJSON({ "a.b": 1 })).toEqual({ a: { b: 1 } });
  expect(cleanupJSON({ a: { "a.b": 1 } })).toEqual({
    a: { a: { b: 1 } },
  });
  expect(cleanupJSON({ a: [{ "a.b": 1 }] })).toEqual({
    a: [{ a: { b: 1 } }],
  });

  expect(cleanupJSON(new Date("2023-05-03T00:00:00Z"))).toBe("2023-05-03");
});

test("JSON utils - deepObjectMerge", () => {
  // Tests for deepClone
  const obj1 = { a: 1, b: { c: 2, d: [3, 4] }, e: new Date("2023-08-21") };
  const clone1 = deepClone(obj1);
  expect(clone1).toEqual(obj1);
  expect(clone1 === obj1).toBe(false); // Ensuring deep clone, not shallow
  expect(clone1.b === obj1.b).toBe(false); // Nested object should be different reference
  expect(clone1.e === obj1.e).toBe(false); // Date object should be different reference

  const arrayTest = [1, 2, { a: 3, b: [4, 5] }];
  const cloneArray = deepClone(arrayTest);
  expect(cloneArray).toEqual(arrayTest);
  expect(cloneArray === arrayTest).toBe(false); // Array itself should be different reference
  expect(cloneArray[2] === arrayTest[2]).toBe(false); // Nested object in array should be different reference

  const nullTest = { a: null, b: undefined, c: { d: null } };
  const cloneNullTest = deepClone(nullTest);
  expect(cloneNullTest).toEqual(nullTest);
  expect(cloneNullTest === nullTest).toBe(false); // Ensure it's a deep clone
  expect(cloneNullTest.c === nullTest.c).toBe(false); // Nested object should be different reference

  const dateTest = new Date();
  const cloneDateTest = deepClone(dateTest);
  expect(cloneDateTest.getTime()).toBe(dateTest.getTime());
  expect(cloneDateTest === dateTest).toBe(false); // Date instance should be different reference
});
