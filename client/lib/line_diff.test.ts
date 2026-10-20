import { expect, test } from "vitest";
import { lineDiff } from "./line_diff.ts";

test("lineDiff marks removed and added lines", () => {
  const diff = lineDiff("a\nb\n", "a\nc\n");
  expect(diff.map((l) => l.text)).toEqual([" a", "-b", "+c"]);
  expect(diff.map((l) => l.cssClass)).toEqual([
    undefined,
    "sb-revision-diff-del",
    "sb-revision-diff-add",
  ]);
});

test("lineDiff of identical text has only context lines", () => {
  expect(lineDiff("x\ny", "x\ny").map((l) => l.text)).toEqual([" x", " y"]);
});

test("lineDiff handles insertions into empty text", () => {
  expect(lineDiff("", "n1\nn2\n").map((l) => l.text)).toEqual(["+n1", "+n2"]);
});
