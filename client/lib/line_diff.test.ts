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

test("a missing final newline shows as its own line", () => {
  expect(lineDiff("foo\n", "foo").map((l) => l.text)).toEqual([
    " foo",
    "+\\ No newline at end",
  ]);
});

test("carriage returns are visible", () => {
  expect(lineDiff("a\r\nb\r\n", "a\nb\n").map((l) => l.text)).toEqual([
    "-a␍",
    "-b␍",
    "+a",
    "+b",
  ]);
});

test("texts with more distinct lines than UTF-16 has units still diff right", () => {
  const lines = Array.from({ length: 70_000 }, (_, i) => `line ${i}`);
  const a = `${lines.join("\n")}\n`;
  const b = `${lines.map((l, i) => (i === 60_000 ? "changed" : l)).join("\n")}\n`;
  const diff = lineDiff(a, b);
  expect(diff).toHaveLength(70_001);
  expect(diff.filter((l) => l.text[0] !== " ").map((l) => l.text)).toEqual([
    "-line 60000",
    "+changed",
  ]);
  // After the changed line, which takes two entries
  expect(diff[65_001].text).toBe(" line 65000");
});
