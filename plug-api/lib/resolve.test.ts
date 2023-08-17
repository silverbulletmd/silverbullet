import {
  cleanPageRef,
  federatedPathToUrl,
  resolvePath,
  rewritePageRefs,
} from "$sb/lib/resolve.ts";
import { assertEquals } from "../../test_deps.ts";
import { parseMarkdown } from "$sb/lib/test_utils.ts";
import { renderToText } from "$sb/lib/tree.ts";

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

<!-- #query page render [[template/page]] -->
<!-- /query -->

<!-- #use [[template/use-template]] {} -->

<!-- /use -->

<!-- #include [[template/include-template]] {} -->

<!-- /include -->
`);
  rewritePageRefs(tree, "!silverbullet.md");
  let rewrittenText = renderToText(tree);

  assertEquals(
    rewrittenText,
    `
This is a [[!silverbullet.md/local link]] and [[!silverbullet.md/local link|with alias]].

<!-- #query page render [[!silverbullet.md/template/page]] -->
<!-- /query -->

<!-- #use [[!silverbullet.md/template/use-template]] {} -->

<!-- /use -->

<!-- #include [[!silverbullet.md/template/include-template]] {} -->

<!-- /include -->
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
