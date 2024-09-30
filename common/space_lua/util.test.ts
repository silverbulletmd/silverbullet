import { evalPromiseValues } from "$common/space_lua/util.ts";
import { assertEquals } from "@std/assert/equals";
import { assert } from "@std/assert";

Deno.test("Test promise helpers", async () => {
  const r = evalPromiseValues([1, 2, 3]);
  // should return the same array not as a promise
  assertEquals(r, [1, 2, 3]);
  const asyncR = evalPromiseValues([
    new Promise((resolve) => {
      setTimeout(() => {
        resolve(1);
      }, 5);
    }),
    Promise.resolve(2),
    3,
  ]);
  // should return a promise
  assert(asyncR instanceof Promise);
  assertEquals(await asyncR, [1, 2, 3]);
});
