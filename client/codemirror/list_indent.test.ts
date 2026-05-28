import { expect, test } from "vitest";
import { parser as baseParser } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import { TaskList } from "../markdown_parser/extended_task.ts";
import { computeMarkerWidth } from "./list_indent.ts";

const parser = baseParser.configure([TaskList]);

// Parse a single-line markdown source and return its first ListItem node + line text.
function firstListItem(source: string): { node: SyntaxNode; source: string } {
  const tree = parser.parse(source);
  let node: SyntaxNode | null = null;
  tree.iterate({
    enter: (n) => {
      if (n.type.name === "ListItem" && !node) {
        node = n.node;
        return false;
      }
    },
  });
  if (!node) throw new Error(`no ListItem in: ${JSON.stringify(source)}`);
  return { node, source };
}

test("computeMarkerWidth: plain unordered with *", () => {
  const { node } = firstListItem("* item");
  expect(computeMarkerWidth(node, 0)).toBe(2);
});

test("computeMarkerWidth: plain unordered with -", () => {
  const { node } = firstListItem("- item");
  expect(computeMarkerWidth(node, 0)).toBe(2);
});

test("computeMarkerWidth: nested unordered (2 leading spaces)", () => {
  const { node } = firstListItem("  * item");
  expect(computeMarkerWidth(node, 0)).toBe(4);
});

test("computeMarkerWidth: task at level 1", () => {
  const { node } = firstListItem("* [ ] task");
  expect(computeMarkerWidth(node, 0)).toBe(6);
});

test("computeMarkerWidth: task at level 2", () => {
  const { node } = firstListItem("  * [ ] task");
  expect(computeMarkerWidth(node, 0)).toBe(8);
});

test("computeMarkerWidth: multi-status task `[done]`", () => {
  // `* [done] task` → marker zone = `* [done] ` = 9 chars
  const { node } = firstListItem("* [done] task");
  expect(computeMarkerWidth(node, 0)).toBe(9);
});

test("computeMarkerWidth: ordered single digit", () => {
  const { node } = firstListItem("1. item");
  expect(computeMarkerWidth(node, 0)).toBe(3);
});

test("computeMarkerWidth: ordered two digits", () => {
  const { node } = firstListItem("10. item");
  expect(computeMarkerWidth(node, 0)).toBe(4);
});

test("computeMarkerWidth: ordered three digits", () => {
  const { node } = firstListItem("100. item");
  expect(computeMarkerWidth(node, 0)).toBe(5);
});

test("computeMarkerWidth: ordered with task", () => {
  const { node } = firstListItem("1. [ ] task");
  expect(computeMarkerWidth(node, 0)).toBe(7);
});

test("computeMarkerWidth: deeply nested unordered (6 leading spaces, level 4)", () => {
  // 6 leading spaces only parses as a ListItem inside a proper nested list,
  // so build a 4-level structure and pick the deepest ListItem.
  const source = "* a\n  * b\n    * c\n      * d";
  const tree = parser.parse(source);
  let deepest: SyntaxNode | null = null;
  let deepestStart = -1;
  tree.iterate({
    enter: (n) => {
      if (n.type.name === "ListItem" && n.from > deepestStart) {
        deepest = n.node;
        deepestStart = n.from;
      }
    },
  });
  if (!deepest) throw new Error("no ListItem");
  const node: SyntaxNode = deepest;
  // The deepest item's line starts at offset 14 (the "      * d" line).
  const lineStart = source.lastIndexOf("\n", node.from) + 1;
  expect(computeMarkerWidth(node, lineStart)).toBe(8);
});

test("computeMarkerWidth: respects non-zero lineStart", () => {
  // Two-line doc: first line is empty (or text), second line is "* item"
  const source = "intro\n* item";
  const tree = parser.parse(source);
  let node: SyntaxNode | null = null;
  tree.iterate({
    enter: (n) => {
      if (n.type.name === "ListItem" && !node) {
        node = n.node;
        return false;
      }
    },
  });
  if (!node) throw new Error("no ListItem");
  // Line start for the second line is at offset 6 (after "intro\n").
  expect(computeMarkerWidth(node, 6)).toBe(2);
});
