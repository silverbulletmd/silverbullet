import { rangeLength } from "$sb/lib/change.ts";
import { assertEquals } from "https://deno.land/std@0.165.0/testing/asserts.ts";

Deno.test("rangeLength", () => {
  assertEquals(rangeLength({ from: 4, to: 11 }), 7);
});
