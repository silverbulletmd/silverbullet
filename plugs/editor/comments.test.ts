import { describe, expect, test } from "vitest";
import { parse } from "../../client/markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../../client/markdown_parser/parser.ts";
import {
  buildCommentInsertion,
  commentAnchor,
  isInFencedCode,
  wrapLines,
} from "./comments.ts";

function treeFor(text: string) {
  return parse(extendedMarkdownLanguage, text);
}

test("wrapping expands the selection to whole lines", () => {
  const text = "alpha\nbeta\ngamma\n";
  const r = wrapLines(text, 7, 9); // inside "beta"
  expect(r.from).toBe(6);
  expect(r.to).toBe(10);
  expect(r.replacement).toBe("<!--\nbeta\n-->");
});

test("a comment is inserted after the block, quoting the selection verbatim", () => {
  const text = "one\ntwo\n\nnext block\n";
  const r = buildCommentInsertion(treeFor(text), text, 0, 7); // "one\ntwo"
  expect(r.insertAt).toBe(7);
  expect(r.text).toBe("\n<!--\n> one\n> two\n\n\n-->");
  expect(text.slice(0, r.insertAt) + r.text).toContain("> one\n> two");
  expect(r.cursorPos).toBe(26);
});

test("blank lines inside the selection stay inside the quote", () => {
  const text = "a\n\nb\n";
  const r = buildCommentInsertion(treeFor(text), text, 0, 4); // "a\n\nb"
  expect(r.text).toBe("\n<!--\n> a\n>\n> b\n\n\n-->");
});

test("without a selection the scaffold is empty", () => {
  const text = "paragraph\n";
  const r = buildCommentInsertion(treeFor(text), text, 9, 9);
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
  const r = buildCommentInsertion(treeFor(text), text, 0, 4); // "one\n" selected including its own newline
  expect(r.text).toBe("\n<!--\n> one\n\n\n-->");
});

describe("commentAnchor", () => {
  test("anchors on the list item the selection ends in, not the whole list", () => {
    const text = "1. one\n2. two\n3. three\n";
    const r = commentAnchor(treeFor(text), text, 13); // end of "two"
    expect(r.insertAt).toBe(13);
    expect(r.indent).toBe("   ");
  });

  test("indents to the innermost item's continuation column", () => {
    const text = "* parent\n  * child one\n  * child two\n";
    const r = commentAnchor(treeFor(text), text, 22); // end of "child one"
    expect(r.insertAt).toBe(22);
    expect(r.indent).toBe("    ");
  });

  test("a parent item anchors after its whole sub-tree", () => {
    const text = "* parent\n  * child one\n  * child two\n";
    const r = commentAnchor(treeFor(text), text, 8); // end of "parent"
    expect(r.insertAt).toBe(36);
    expect(r.indent).toBe("  ");
  });

  test("a task indents to the list mark, not past the checkbox", () => {
    // Past the checkbox is content indent + 4, which parses as indented code.
    const text = "* [ ] a task\n";
    const r = commentAnchor(treeFor(text), text, 12);
    expect(r.indent).toBe("  ");
  });

  test("outside a list the anchor is the end of the block", () => {
    const text = "one\ntwo\n\nnext block\n";
    const r = commentAnchor(treeFor(text), text, 7);
    expect(r.insertAt).toBe(7);
    expect(r.indent).toBe("");
  });

  test("a block ends where the next one starts, even without a blank line between", () => {
    const text = "Hello\n## Deep nesting\n- Level 1\n";
    const r = commentAnchor(treeFor(text), text, 5); // end of "Hello"
    expect(r.insertAt).toBe(5);
    expect(r.indent).toBe("");
  });

  test("on a blank line the anchor is that line, not the block below it", () => {
    const text = "para\n\nnext\n";
    const r = commentAnchor(treeFor(text), text, 5); // the blank line
    expect(r.insertAt).toBe(5);
  });
});

test("on a blank line the scaffold starts on that line rather than below it", () => {
  const text = "para\n\nnext\n";
  const r = buildCommentInsertion(treeFor(text), text, 5, 5);
  expect(r.insertAt).toBe(5);
  expect(r.text).toBe("<!--\n\n-->");
  expect(text.slice(0, r.insertAt) + r.text + text.slice(r.insertAt)).toBe(
    "para\n<!--\n\n-->\nnext\n",
  );
});

test("a comment on a list item is indented into that item", () => {
  const text = "1. one\n2. two\n3. three\n";
  const r = buildCommentInsertion(treeFor(text), text, 10, 13); // "two"
  expect(r.insertAt).toBe(13);
  expect(r.text).toBe("\n   <!--\n   > two\n\n   \n   -->");
  expect(r.cursorPos).toBe(13 + r.text.length - 7);
});

test("the cursor lands in the comment's column, not back at the margin", () => {
  const text = "1. one\n2. two\n3. three\n";
  const r = buildCommentInsertion(treeFor(text), text, 10, 13); // "two"
  const typed =
    text.slice(0, r.insertAt) +
    r.text.slice(0, r.cursorPos - r.insertAt) +
    "note" +
    r.text.slice(r.cursorPos - r.insertAt);
  expect(typed).toContain("\n   note\n   -->");
});

test("an unquoted scaffold indents the line the cursor lands on", () => {
  const text = "1. one\n";
  const r = buildCommentInsertion(treeFor(text), text, 6, 6);
  expect(r.text).toBe("\n   <!--\n   \n   -->");
  // The caret sits after the indent, so typing starts in the right column.
  expect(r.cursorPos).toBe(r.insertAt + r.text.length - 7);
});

test("a cursor on the blank line after a list anchors outside the list", () => {
  const text = "1. one\n";
  const r = commentAnchor(treeFor(text), text, 7);
  expect(r.insertAt).toBe(7);
  expect(r.indent).toBe("");
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
