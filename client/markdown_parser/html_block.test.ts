import { expect, test } from "vitest";
import { parse } from "./parse_tree.ts";
import { extendedMarkdownLanguage } from "./parser.ts";
import type { ParseTree } from "../../plug-api/lib/tree.ts";

function parseHtml(md: string): ParseTree {
  return parse(extendedMarkdownLanguage, md);
}

/** Recursively collect all node types in tree order. */
function collectTypes(tree: ParseTree): (string | undefined)[] {
  const result: (string | undefined)[] = [];
  if (tree.type) result.push(tree.type);
  if (tree.children) {
    for (const child of tree.children) {
      result.push(...collectTypes(child));
    }
  }
  return result;
}

/** Depth-first search for the first node of a given type. */
function findNode(tree: ParseTree, type: string): ParseTree | undefined {
  if (tree.type === type) return tree;
  for (const child of tree.children ?? []) {
    const hit = findNode(child, type);
    if (hit) return hit;
  }
  return undefined;
}

/** Get the first child of the Document node. */
function topNode(tree: ParseTree): ParseTree {
  return tree.children![0];
}

/** Get the text content of a node (from its text children). */
function nodeText(tree: ParseTree): string {
  if (tree.text !== undefined) return tree.text;
  return tree.children?.map((c) => nodeText(c)).join("") ?? "";
}

test("simple table produces HTMLBlock with structured children", () => {
  const tree = parseHtml("<table><tr><td>hello</td></tr></table>");
  const block = topNode(tree);
  expect(block.type).toBe("HTMLBlock");

  const childTypes = block.children!.filter((c) => c.type).map((c) => c.type);
  expect(childTypes).toEqual([
    "HTMLOpenTag",
    "HTMLOpenTag",
    "HTMLOpenTag",
    "HTMLCloseTag",
    "HTMLCloseTag",
    "HTMLCloseTag",
  ]);
});

test("self-closing tag produces HTMLSelfClosingTag", () => {
  const tree = parseHtml("<div><br /><hr /></div>");
  const block = topNode(tree);
  const selfClosing = block.children!.filter(
    (c) => c.type === "HTMLSelfClosingTag",
  );
  expect(selfClosing).toHaveLength(2);
  expect(nodeText(selfClosing[0])).toBe("<br />");
  expect(nodeText(selfClosing[1])).toBe("<hr />");
});

test("bold markdown inside td is parsed", () => {
  const tree = parseHtml("<td>hello **world**</td>");
  const block = topNode(tree);
  const types = collectTypes(block);
  expect(types).toContain("StrongEmphasis");
});

test("wiki link inside td is parsed", () => {
  const tree = parseHtml("<td>see [[MyPage]]</td>");
  const block = topNode(tree);
  const types = collectTypes(block);
  expect(types).toContain("WikiLink");
  expect(types).toContain("WikiLinkPage");
});

test("HTML comments produce CommentBlock", () => {
  const tree = parseHtml("<!-- this is a comment -->");
  expect(topNode(tree).type).toBe("CommentBlock");
});

test("script block produces HTMLBlock (not structured)", () => {
  const tree = parseHtml("<script>alert(1)</script>");
  const block = topNode(tree);
  expect(block.type).toBe("HTMLBlock");
  const hasOpenTag = block.children?.some((c) => c.type === "HTMLOpenTag");
  expect(hasOpenTag).toBeFalsy();
});

test("processing instruction produces ProcessingInstructionBlock", () => {
  const tree = parseHtml("<?xml version='1.0'?>");
  expect(topNode(tree).type).toBe("ProcessingInstructionBlock");
});

test("a comment body is parsed as markdown", () => {
  const tree = parseHtml("<!--\n\n* [ ] Hello\n\n-->\n");
  const node = topNode(tree);
  expect(node.type).toBe("CommentBlock");
  const types = collectTypes(node);
  expect(types).toContain("BulletList");
  expect(types).toContain("Task");
  expect(types).toContain("CommentMarker");
});

test("marker comments stay flat", () => {
  for (const src of ["<!--#lua 3 + 4 -->\n", "<!--/lua-->\n"]) {
    const node = topNode(parseHtml(src));
    expect(node.type).toBe("CommentMarkerBlock");
    expect(collectTypes(node)).not.toContain("Paragraph");
  }
});

test("an unclosed comment consumes the rest of the document", () => {
  const tree = parseHtml("before\n\n<!--\nstill inside\n");
  const node = tree.children![tree.children!.length - 1];
  expect(node.type).toBe("CommentBlock");
  expect(nodeText(node)).toContain("still inside");
});

// Enclosing quote/list prefixes are reparsed as structure inside comments.
// Offsets remain valid, but the resulting node types are wrong.
test("a quoted comment reparses its own quote markers", () => {
  const doc = "> <!--\n> * item\n> -->\n";
  const tree = parseHtml(doc);
  const comment = findNode(tree, "CommentBlock")!;
  expect(collectTypes(comment)).toContain("Blockquote");
  expect(doc.slice(comment.from!, comment.to!)).toBe("<!--\n> * item\n> -->");
});

test("a deeply indented comment reparses its indent as a code block", () => {
  const doc = "* outer\n\n    <!--\n    * inner\n    -->\n";
  const tree = parseHtml(doc);
  const comment = findNode(tree, "CommentBlock")!;
  const types = collectTypes(comment);
  expect(types).toContain("CodeBlock");
  expect(types).not.toContain("BulletList");
  const code = findNode(comment, "CodeText")!;
  expect(doc.slice(code.from!, code.to!)).toBe("* inner");
});

test("spliced children keep document offsets", () => {
  const doc = "lead\n\n<!--\n* item\n-->\n";
  const tree = parseHtml(doc);
  const comment = tree.children!.find((c) => c.type === "CommentBlock")!;
  const findItem = (t: typeof tree): typeof tree | undefined => {
    if (t.type === "ListItem") return t;
    for (const child of t.children ?? []) {
      const hit = findItem(child);
      if (hit) return hit;
    }
    return undefined;
  };
  const item = findItem(comment)!;
  expect(doc.slice(item.from!, item.to!)).toBe("* item");
});
