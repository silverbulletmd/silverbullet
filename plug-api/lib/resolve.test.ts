import {
  cleanPageRef,
  federatedPathToUrl,
  resolvePath,
  rewritePageRefs,
} from "@silverbulletmd/silverbullet/lib/resolve";
import { assertEquals } from "@std/assert";
import { type ParseTree, renderToText } from "./tree.ts";
import { parse } from "$common/markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "$common/markdown_parser/parser.ts";

Deno.test("Test URL resolver", () => {
  // Absolute paths
  assertEquals("some page", resolvePath("test", "/some page"));
  assertEquals("some page", resolvePath("/folder/test", "/some page"));
  assertEquals("bla@123", resolvePath("somewhere", "/bla@123"));
  assertEquals("test.jpg", resolvePath("folder/test", "/test.jpg"));
  assertEquals(
    resolvePath("!v1.silverbullet.md", "/some page"),
    "!v1.silverbullet.md/some page",
  );
  assertEquals(
    resolvePath("!v1.silverbullet.md/some/deep/path", "/some page"),
    "!v1.silverbullet.md/some page",
  );
  assertEquals(
    "!v1.silverbullet.md/test.jpg",
    resolvePath("!v1.silverbullet.md/something/bla", "/test.jpg"),
  );
  assertEquals(
    resolvePath("!v1.silverbullet.md", "/test/image.png", true),
    "https://v1.silverbullet.md/test/image.png",
  );

  // Relative paths
  assertEquals("test.jpg", resolvePath("test", "test.jpg"));
  assertEquals("folder/test.jpg", resolvePath("folder/test", "test.jpg"));
  assertEquals(
    resolvePath("!v1.silverbullet.md", "some page"),
    "!v1.silverbullet.md/some page",
  );
  assertEquals(
    "!v1.silverbullet.md/something/test.jpg",
    resolvePath("!v1.silverbullet.md/something/bla", "test.jpg"),
  );
  assertEquals(
    resolvePath("!v1.silverbullet.md", "bla@123"),
    "!v1.silverbullet.md/bla@123",
  );
  assertEquals(
    resolvePath("!v1.silverbullet.md", "test/image.png", true),
    "https://v1.silverbullet.md/test/image.png",
  );
  // Federated pages
  assertEquals(resolvePath("!bla/bla", "!bla/bla2"), "!bla/bla2");
  assertEquals(
    federatedPathToUrl("!v1.silverbullet.md"),
    "https://v1.silverbullet.md",
  );
  assertEquals(
    federatedPathToUrl("!v1.silverbullet.md/index"),
    "https://v1.silverbullet.md/index",
  );

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
  rewritePageRefs(tree, "!v1.silverbullet.md");
  let rewrittenText = renderToText(tree);

  assertEquals(
    rewrittenText,
    `
This is a [[!v1.silverbullet.md/local link]] and [[!v1.silverbullet.md/local link|with alias]].

\`\`\`query
page render [[!v1.silverbullet.md/template/page]]
\`\`\`

\`\`\`template
page: "[[!v1.silverbullet.md/template/use-template]]"
\`\`\`
`,
  );

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
