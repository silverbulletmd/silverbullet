import type { SyntaxNode } from "@lezer/common";
import { expect, test } from "vitest";
import { lezerToParseTree } from "./parse_tree.ts";
import { extendedMarkdownLanguage } from "./parser.ts";

const DOC = [
  "# Title",
  "",
  "Some text with <b>bold</b> and <br/> in it.",
  "",
  "| A | B |",
  "|---|---|",
  "| 1 <meta x='a'> | two |",
  "| three | <span>4</span> |",
  "",
  "<details>",
  "<summary>More</summary>",
  "Hidden",
  "</details>",
  "",
].join("\n");

function nodesNamed(names: readonly string[]): SyntaxNode[] {
  const tree = extendedMarkdownLanguage.parser.parse(DOC);
  const found: SyntaxNode[] = [];
  tree.iterate({
    enter: (node) => {
      if (names.includes(node.name)) found.push(node.node);
    },
  });
  return found;
}

test("a node's tree from its own text (textFrom) is the tree from the whole document", () => {
  const nodes = nodesNamed(["Paragraph", "Table", "TableCell", "HTMLBlock"]);
  expect(nodes.map((n) => n.name)).toEqual(
    expect.arrayContaining(["Paragraph", "Table", "TableCell", "HTMLBlock"]),
  );
  for (const node of nodes) {
    const whole = lezerToParseTree(DOC, node);
    const own = lezerToParseTree(
      DOC.slice(node.from, node.to),
      node,
      0,
      node.from,
    );
    expect(own).toEqual(whole);
  }
});

test("textFrom with an offset: positions shifted by the offset, the text read from where it starts", () => {
  for (const node of nodesNamed(["Paragraph", "TableCell", "HTMLBlock"])) {
    const whole = lezerToParseTree(DOC, node, 10);
    const own = lezerToParseTree(
      DOC.slice(node.from, node.to),
      node,
      10,
      node.from,
    );
    expect(own).toEqual(whole);
  }
});
