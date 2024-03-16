import { assertEquals } from "$std/testing/asserts.ts";
import { deepEqual, deepObjectMerge, expandPropertyNames } from "./json.ts";

Deno.test("utils", () => {
  assertEquals(deepEqual({ a: 1 }, { a: 1 }), true);
  assertEquals(deepObjectMerge({ a: 1 }, { a: 2 }), { a: 2 });
  assertEquals(
    deepObjectMerge({ list: [1, 2, 3] }, { list: [4, 5, 6] }),
    { list: [1, 2, 3, 4, 5, 6] },
  );
  assertEquals(deepObjectMerge({ a: { b: 1 } }, { a: { c: 2 } }), {
    a: { b: 1, c: 2 },
  });
  assertEquals(expandPropertyNames({ "a.b": 1 }), { a: { b: 1 } });
  assertEquals(expandPropertyNames({ a: { "a.b": 1 } }), {
    a: { a: { b: 1 } },
  });
  assertEquals(expandPropertyNames({ a: [{ "a.b": 1 }] }), {
    a: [{ a: { b: 1 } }],
  });
});
