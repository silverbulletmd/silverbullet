import { parse } from "./parse_tree.ts";
import buildMarkdown from "./parser.ts";
import { findNodeOfType, renderToText } from "../plug-api/lib/tree.ts";
import { assertEquals, assertNotEquals } from "../test_deps.ts";

const sample1 = `---
type: page
tags:
- hello
- world
---
# This is a doc

Supper`;

const sampleInvalid1 = `---
name: Zef
# This is a doc

Supper`;

Deno.test("Test parser", () => {
  const lang = buildMarkdown([]);
  let tree = parse(
    lang,
    sample1,
  );
  console.log("tree", JSON.stringify(tree, null, 2));
  // Check if rendering back to text works
  assertEquals(renderToText(tree), sample1);
  let node = findNodeOfType(tree, "FrontMatter");
  assertNotEquals(node, undefined);
  tree = parse(lang, sampleInvalid1);
  node = findNodeOfType(tree, "FrontMatter");
  // console.log("Invalid node", node);
  assertEquals(node, undefined);
});
