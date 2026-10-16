import { expect, test } from "vitest";
import { clampDockSize, maxDockHeight } from "./dock_size.ts";

test("the bottom dock leaves room for the editor", () => {
  expect(maxDockHeight(1000)).toBe(800);
  expect(clampDockSize("bhs", 5000, 1000)).toBe(800);
});

test("a tiny window still allows the minimum height", () => {
  expect(maxDockHeight(250)).toBe(160);
});

test("side docks keep a fixed width range", () => {
  expect(clampDockSize("rhs", 5000, 2000)).toBe(600);
  expect(clampDockSize("lhs", 10)).toBe(160);
});
