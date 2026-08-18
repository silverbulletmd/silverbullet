import { describe, expect, test } from "vitest";
import { parse } from "../../client/markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../../client/markdown_parser/parser.ts";
import {
  buildCommentInsertion,
  isInFencedCode,
  wrapLines,
} from "./comments.ts";

test("wrapping expands the selection to whole lines", () => {
  const text = "alpha\nbeta\ngamma\n";
  const r = wrapLines(text, 7, 9); // inside "beta"
  expect(r.from).toBe(6);
  expect(r.to).toBe(10);
  expect(r.replacement).toBe("<!--\nbeta\n-->");
});

test("a comment is inserted after the block, quoting the selection verbatim", () => {
  const text = "one\ntwo\n\nnext block\n";
  const r = buildCommentInsertion(text, 0, 7); // "one\ntwo"
  expect(r.insertAt).toBe(7);
  expect(r.text).toBe("\n<!--\n> one\n> two\n\n\n-->");
  expect(text.slice(0, r.insertAt) + r.text).toContain("> one\n> two");
  expect(r.cursorPos).toBe(26);
});

test("blank lines inside the selection stay inside the quote", () => {
  const text = "a\n\nb\n";
  const r = buildCommentInsertion(text, 0, 4); // "a\n\nb"
  expect(r.text).toBe("\n<!--\n> a\n>\n> b\n\n\n-->");
});

test("without a selection the scaffold is empty", () => {
  const text = "paragraph\n";
  const r = buildCommentInsertion(text, 9, 9);
  expect(r.text).toBe("\n<!--\n\n-->");
  expect(r.cursorPos).toBe(15);
});

test("wrapLines does not pull in the next line when the selection ends on its own trailing newline", () => {
  const text = "alpha\nbeta\ngamma\n";
  const r = wrapLines(text, 6, 11); // "beta\n" selected including its own newline
  expect(r.from).toBe(6);
  expect(r.to).toBe(10);
  expect(r.replacement).toBe("<!--\nbeta\n-->");
});

test("wrapLines handles a multi-line selection ending on its own trailing newline", () => {
  const text = "alpha\nbeta\ngamma\n";
  const r = wrapLines(text, 0, 11); // "alpha\nbeta\n" selected including its own newline
  expect(r.from).toBe(0);
  expect(r.to).toBe(10);
  expect(r.replacement).toBe("<!--\nalpha\nbeta\n-->");
});

test("wrapLines does not drop a leading blank line when the selection starts at offset 0", () => {
  const text = "\nfoo\nbar\n";
  const r = wrapLines(text, 0, 3);
  expect(r.from).toBe(0);
});

test("buildCommentInsertion does not emit a spurious bare '>' when the selection ends on its own trailing newline", () => {
  const text = "one\ntwo\n\nnext block\n";
  const r = buildCommentInsertion(text, 0, 4); // "one\n" selected including its own newline
  expect(r.text).toBe("\n<!--\n> one\n\n\n-->");
});

describe("isInFencedCode", () => {
  const doc = [
    "A paragraph.",
    "",
    "```javascript",
    "const x = 1;",
    "```",
    "",
    "> quoted text",
    "",
  ].join("\n");

  test("is true inside a fenced block's body", () => {
    const tree = parse(extendedMarkdownLanguage, doc);
    expect(isInFencedCode(tree, doc.indexOf("const x"))).toBe(true);
  });

  test("is false in ordinary prose and in a blockquote", () => {
    const tree = parse(extendedMarkdownLanguage, doc);
    expect(isInFencedCode(tree, doc.indexOf("A paragraph"))).toBe(false);
    expect(isInFencedCode(tree, doc.indexOf("quoted text"))).toBe(false);
  });

  test("is false just past the closing fence", () => {
    const tree = parse(extendedMarkdownLanguage, doc);
    expect(isInFencedCode(tree, doc.indexOf("> quoted"))).toBe(false);
  });
});
