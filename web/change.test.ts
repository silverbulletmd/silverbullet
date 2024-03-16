import { rangeLength, rangesOverlap } from "./change.ts";
import { assertEquals } from "$std/testing/asserts.ts";

Deno.test("rangeLength", () => {
  assertEquals(rangeLength({ from: 4, to: 11 }), 7);
});

Deno.test("rangesOverlap", () => {
  assertEquals(
    rangesOverlap({ from: 0, to: 5 }, { from: 3, to: 8 }),
    true,
  );
  assertEquals(
    rangesOverlap({ from: 0, to: 5 }, { from: 6, to: 8 }),
    false,
  );
  // `to` is exclusive
  assertEquals(
    rangesOverlap({ from: 0, to: 6 }, { from: 6, to: 8 }),
    false,
  );
  assertEquals(
    rangesOverlap({ from: 3, to: 6 }, { from: 0, to: 4 }),
    true,
  );
});
