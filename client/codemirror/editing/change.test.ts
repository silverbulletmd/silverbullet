import { expect, test } from "vitest";
import { rangeLength, rangesOverlap } from "./change.ts";

test("rangeLength", () => {
  expect(rangeLength({ from: 4, to: 11 })).toEqual(7);
});

test("rangesOverlap", () => {
  expect(rangesOverlap({ from: 0, to: 5 }, { from: 3, to: 8 })).toEqual(true);
  expect(rangesOverlap({ from: 0, to: 5 }, { from: 6, to: 8 })).toEqual(false);
  // `to` is exclusive
  expect(rangesOverlap({ from: 0, to: 6 }, { from: 6, to: 8 })).toEqual(false);
  expect(rangesOverlap({ from: 3, to: 6 }, { from: 0, to: 4 })).toEqual(true);
});
