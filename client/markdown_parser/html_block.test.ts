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

/** Get the first child of the Document node. */
function topNode(tree: ParseTree): ParseTree {
  return tree.children![0];
}

/** Get the text content of a node (from its text children). */
function nodeText(tree: ParseTree): string {
  if (tree.text !== undefined) return tree.text;
  return tree.children?.map((c) => nodeText(c)).join("") ?? "";
}

// ── Basic structure ──────────────────────────────────────────────────

test("simple table produces HTMLBlock with structured children", () => {
  const tree = parseHtml("<table><tr><td>hello</td></tr></table>");
  const block = topNode(tree);
  expect(block.type).toBe("HTMLBlock");

  const childTypes = block.children!
    .filter((c) => c.type)
    .map((c) => c.type);
  expect(childTypes).toEqual([
    "HTMLOpenTag",
    "HTMLOpenTag",
    "HTMLOpenTag",
    "HTMLCloseTag",
    "HTMLCloseTag",
    "HTMLCloseTag",
  ]);
});

test("tag text is preserved in children", () => {
  const tree = parseHtml("<div>content</div>");
  const block = topNode(tree);
  const openTag = block.children!.find((c) => c.type === "HTMLOpenTag")!;
  expect(nodeText(openTag)).toBe("<div>");

  const closeTag = block.children!.find((c) => c.type === "HTMLCloseTag")!;
  expect(nodeText(closeTag)).toBe("</div>");

  // Text between tags
  const textNodes = block.children!.filter((c) => !c.type);
  expect(textNodes.some((t) => t.text === "content")).toBe(true);
});

// ── Attributes on tags ──────────────────────────────────────────────

test("attributes are preserved in HTMLOpenTag text", () => {
  const tree = parseHtml(
    '<td data-type="number" class="cell">42</td>',
  );
  const block = topNode(tree);
  const openTag = block.children!.find((c) => c.type === "HTMLOpenTag")!;
  expect(nodeText(openTag)).toBe('<td data-type="number" class="cell">');
});

// ── Self-closing tags ───────────────────────────────────────────────

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

// ── Markdown inside HTML ────────────────────────────────────────────

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

test("hashtag inside td is parsed", () => {
  const tree = parseHtml("<td>#sometag</td>");
  const block = topNode(tree);
  const types = collectTypes(block);
  expect(types).toContain("Hashtag");
});

test("italic and bold in list item", () => {
  const tree = parseHtml("<ul><li>_italic_ and **bold**</li></ul>");
  const block = topNode(tree);
  const types = collectTypes(block);
  expect(types).toContain("Emphasis");
  expect(types).toContain("StrongEmphasis");
});

// ── Multi-line HTML blocks ──────────────────────────────────────────

test("multi-line table is parsed correctly", () => {
  const md = `<table>
<tr><td>row1</td></tr>
<tr><td>row2</td></tr>
</table>`;
  const tree = parseHtml(md);
  const block = topNode(tree);
  expect(block.type).toBe("HTMLBlock");

  const openTags = block.children!.filter((c) => c.type === "HTMLOpenTag");
  // table + 2x tr + 2x td = 5
  expect(openTags).toHaveLength(5);
});

// ── Nested same-name tags ───────────────────────────────────────────

test("nested same-name tags are handled", () => {
  const tree = parseHtml("<div><div>inner</div></div>");
  const block = topNode(tree);
  const opens = block.children!.filter((c) => c.type === "HTMLOpenTag");
  const closes = block.children!.filter((c) => c.type === "HTMLCloseTag");
  expect(opens).toHaveLength(2);
  expect(closes).toHaveLength(2);
});

// ── Complex table with data attributes and markdown ─────────────────

test("table with data attributes and markdown in cells", () => {
  const md = `<table>
<thead><tr><th>name</th><th>age</th></tr></thead>
<tbody>
<tr><td data-table-cell-type="string">[[Alice]]</td><td data-table-cell-type="number">30</td></tr>
</tbody>
</table>`;
  const tree = parseHtml(md);
  const block = topNode(tree);
  expect(block.type).toBe("HTMLBlock");

  // Check wiki link is parsed
  const types = collectTypes(block);
  expect(types).toContain("WikiLink");

  // Check data attributes are in tag text
  const openTags = block.children!.filter((c) => c.type === "HTMLOpenTag");
  const tdWithAttr = openTags.find((t) =>
    nodeText(t).includes("data-table-cell-type")
  );
  expect(tdWithAttr).toBeDefined();
  expect(nodeText(tdWithAttr!)).toContain('data-table-cell-type="string"');
});

// ── Comments, scripts, processing instructions ──────────────────────

test("HTML comments produce CommentBlock", () => {
  const tree = parseHtml("<!-- this is a comment -->");
  expect(topNode(tree).type).toBe("CommentBlock");
});

test("multi-line comment produces CommentBlock", () => {
  const md = `<!--
multi-line
comment
-->`;
  const tree = parseHtml(md);
  expect(topNode(tree).type).toBe("CommentBlock");
});

test("script block produces HTMLBlock (not structured)", () => {
  const tree = parseHtml("<script>alert(1)</script>");
  const block = topNode(tree);
  expect(block.type).toBe("HTMLBlock");
  // Should be a flat text blob, not structured
  const hasOpenTag = block.children?.some((c) => c.type === "HTMLOpenTag");
  expect(hasOpenTag).toBeFalsy();
});

test("pre block produces HTMLBlock (not structured)", () => {
  const tree = parseHtml("<pre>code here</pre>");
  const block = topNode(tree);
  expect(block.type).toBe("HTMLBlock");
  const hasOpenTag = block.children?.some((c) => c.type === "HTMLOpenTag");
  expect(hasOpenTag).toBeFalsy();
});

test("processing instruction produces ProcessingInstructionBlock", () => {
  const tree = parseHtml("<?xml version='1.0'?>");
  expect(topNode(tree).type).toBe("ProcessingInstructionBlock");
});

// ── Non-HTML content is unaffected ──────────────────────────────────

test("regular paragraph is not affected", () => {
  const tree = parseHtml("Just some text");
  expect(topNode(tree).type).toBe("Paragraph");
});

test("inline HTML in paragraph still works", () => {
  const tree = parseHtml("Hello <b>bold</b> world");
  const para = topNode(tree);
  expect(para.type).toBe("Paragraph");
  const types = collectTypes(para);
  expect(types).toContain("HTMLTag");
});

test("markdown table is not affected", () => {
  const md = `| a | b |
| -- | -- |
| 1 | 2 |`;
  const tree = parseHtml(md);
  expect(topNode(tree).type).toBe("Table");
});

// ── Empty and edge cases ────────────────────────────────────────────

test("empty div", () => {
  const tree = parseHtml("<div></div>");
  const block = topNode(tree);
  expect(block.type).toBe("HTMLBlock");
  const opens = block.children!.filter((c) => c.type === "HTMLOpenTag");
  const closes = block.children!.filter((c) => c.type === "HTMLCloseTag");
  expect(opens).toHaveLength(1);
  expect(closes).toHaveLength(1);
});

test("table with empty cells", () => {
  const tree = parseHtml("<table><tr><td></td><td></td></tr></table>");
  const block = topNode(tree);
  expect(block.type).toBe("HTMLBlock");
  const opens = block.children!.filter((c) => c.type === "HTMLOpenTag");
  // table + tr + 2x td = 4
  expect(opens).toHaveLength(4);
});

test("data-table-empty attribute on table", () => {
  const tree = parseHtml('<table data-table-empty></table>');
  const block = topNode(tree);
  expect(block.type).toBe("HTMLBlock");
  const openTag = block.children!.find((c) => c.type === "HTMLOpenTag")!;
  expect(nodeText(openTag)).toContain("data-table-empty");
});
