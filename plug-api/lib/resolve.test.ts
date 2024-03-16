import {
  cleanPageRef,
  federatedPathToUrl,
  resolveAttachmentPath,
  resolvePath,
  rewritePageRefs,
} from "$sb/lib/resolve.ts";
import { assertEquals } from "$std/testing/asserts.ts";
import { ParseTree, renderToText } from "./tree.ts";
import { parse } from "$common/markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "$common/markdown_parser/parser.ts";

Deno.test("Test URL resolver", () => {
  assertEquals(resolvePath("test", "some page"), "some page");
  assertEquals(
    resolvePath("!silverbullet.md", "some page"),
    "!silverbullet.md/some page",
  );
  assertEquals(
    resolvePath("!silverbullet.md/some/deep/path", "some page"),
    "!silverbullet.md/some page",
  );
  assertEquals(resolvePath("!bla/bla", "!bla/bla2"), "!bla/bla2");

  assertEquals(
    resolvePath("!silverbullet.md", "test/image.png", true),
    "https://silverbullet.md/test/image.png",
  );

  assertEquals(
    resolvePath("!silverbullet.md", "bla@123"),
    "!silverbullet.md/bla@123",
  );
  assertEquals(resolvePath("somewhere", "bla@123"), "bla@123");

  assertEquals(
    federatedPathToUrl("!silverbullet.md"),
    "https://silverbullet.md",
  );
  assertEquals(
    federatedPathToUrl("!silverbullet.md/index"),
    "https://silverbullet.md/index",
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
  rewritePageRefs(tree, "!silverbullet.md");
  let rewrittenText = renderToText(tree);

  assertEquals(
    rewrittenText,
    `
This is a [[!silverbullet.md/local link]] and [[!silverbullet.md/local link|with alias]].

\`\`\`query
page render [[!silverbullet.md/template/page]]
\`\`\`

\`\`\`template
page: "[[!silverbullet.md/template/use-template]]"
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

  assertEquals("test.jpg", resolveAttachmentPath("test", "test.jpg"));
  assertEquals(
    "folder/test.jpg",
    resolveAttachmentPath("folder/test", "test.jpg"),
  );
  assertEquals(
    "test.jpg",
    resolveAttachmentPath("folder/test", "/test.jpg"),
  );
  assertEquals(
    "https://silverbullet.md/something/test.jpg",
    resolveAttachmentPath("!silverbullet.md/something/bla", "test.jpg"),
  );
  assertEquals(
    "https://silverbullet.md/test.jpg",
    resolveAttachmentPath("!silverbullet.md/something/bla", "/test.jpg"),
  );
});

function parseMarkdown(text: string): ParseTree {
  return parse(extendedMarkdownLanguage, text);
}
