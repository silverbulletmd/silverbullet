import { assertEquals } from "@std/assert";
import { cleanupJSON, deepEqual, deepObjectMerge } from "./json.ts";

Deno.test("JSON utils", () => {
  assertEquals(deepEqual({ a: 1 }, { a: 1 }), true);
  assertEquals(deepEqual({ a: null }, { a: null }), true);
  assertEquals(deepEqual({ a: {} }, { a: null }), false);
  assertEquals(deepEqual({ a: {} }, { a: undefined }), false);
  assertEquals(deepEqual({ a: null }, { a: {} }), false);
  assertEquals(deepObjectMerge({ a: 1 }, { a: 2 }), { a: 2 });
  assertEquals(
    deepObjectMerge({ list: [1, 2, 3] }, { list: [4, 5, 6] }),
    { list: [1, 2, 3, 4, 5, 6] },
  );
  assertEquals(deepObjectMerge({ a: { b: 1 } }, { a: { c: 2 } }), {
    a: { b: 1, c: 2 },
  });
  assertEquals(cleanupJSON({ "a.b": 1 }), { a: { b: 1 } });
  assertEquals(cleanupJSON({ a: { "a.b": 1 } }), {
    a: { a: { b: 1 } },
  });
  assertEquals(cleanupJSON({ a: [{ "a.b": 1 }] }), {
    a: [{ a: { b: 1 } }],
  });
  assertEquals(
    cleanupJSON(new Date("2023-05-13T12:30:00Z")),
    "2023-05-13T12:30:00.000Z",
  );
  assertEquals(cleanupJSON(new Date("2023-05-03T00:00:00Z")), "2023-05-03");
});
