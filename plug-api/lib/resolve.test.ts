import {
  cleanPageRef,
  resolvePath,
  rewritePageRefs,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { assertEquals } from "@std/assert";
import { type ParseTree, renderToText } from "./tree.ts";
import { parse } from "../../web/markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../../web/markdown_parser/parser.ts";

Deno.test("Test URL resolver", () => {
  // Absolute paths
  assertEquals("some page", resolvePath("test", "/some page"));
  assertEquals("some page", resolvePath("/folder/test", "/some page"));
  assertEquals("bla@123", resolvePath("somewhere", "/bla@123"));
  assertEquals("test.jpg", resolvePath("folder/test", "/test.jpg"));

  // Relative paths
  assertEquals("test.jpg", resolvePath("test", "test.jpg"));
  assertEquals("folder/test.jpg", resolvePath("folder/test", "test.jpg"));

  assertEquals(cleanPageRef("hello"), "hello");
  assertEquals(cleanPageRef("[[hello]]"), "hello");
});

Deno.test("Test rewritePageRefs", () => {
  let tree = parseMarkdown(`
This is a [[local link]] and [[local link|with alias]].

\`\`\`query
page render [[template/page]]
\`\`\`

\`\`\`template
page: "[[template/use-template]]"
\`\`\`
`);
  let rewrittenText = renderToText(tree);

  tree = parseMarkdown(
    `This is a [[local link]] and [[local link|with alias]].`,
  );
  // Now test the default case without federated links
  rewritePageRefs(tree, "index");
  rewrittenText = renderToText(tree);
  assertEquals(
    rewrittenText,
    `This is a [[local link]] and [[local link|with alias]].`,
  );
});

function parseMarkdown(text: string): ParseTree {
  return parse(extendedMarkdownLanguage, text);
}
