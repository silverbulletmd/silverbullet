import { expect, test } from "vitest";
import { lineEnd, lineStart } from "./lines.ts";

test("lineStart", () => {
  expect(lineStart("ab\ncd", 0)).toBe(0);
  expect(lineStart("ab\ncd", 2)).toBe(0);
  expect(lineStart("ab\ncd", 3)).toBe(3);
  expect(lineStart("ab\ncd", 4)).toBe(3);
  // Empty first line: must not find the newline at index 0
  expect(lineStart("\nfoo", 0)).toBe(0);
  expect(lineStart("\nfoo", 1)).toBe(1);
});

test("lineEnd", () => {
  expect(lineEnd("ab\ncd", 0)).toBe(2);
  expect(lineEnd("ab\ncd", 3)).toBe(5);
  expect(lineEnd("\nfoo", 0)).toBe(0);
});
