import { assertEquals } from "../../test_deps.ts";
import { parse } from "../../common/markdown_parser/parse_tree.ts";
import wikiMarkdownLang from "../../common/markdown_parser/parser.ts";
import {
  translateLinksWithoutPrefix,
  translateLinksWithPrefix,
} from "./translate.ts";
import { renderToText } from "$sb/lib/tree.ts";

const page = `
Hello there, here's a link to a [[page]]. And here's a link to a [[!federated.com/page]].

I'm also going to use a query!

<!-- #query page render [[template/page]] -->
<!-- /query -->

<!-- #query task where done = false -->
<!-- /query -->

<!-- #query page render [[!federated.com/template/page]] -->
<!-- /query -->

<!-- #use [[template/blabla]] -->
<!-- /use -->

<!-- #include [[template/blabla]] -->
<!-- /include -->
`;

const expectedPage = `
Hello there, here's a link to a [[!someplace/page]]. And here's a link to a [[!federated.com/page]].

I'm also going to use a query!

<!-- #query page where name =~ /^!someplace\\// render [[!someplace/template/page]] -->
<!-- /query -->

<!-- #query task where page =~ /^!someplace\\// where done = false -->
<!-- /query -->

<!-- #query page where name =~ /^!someplace\\// render [[!federated.com/template/page]] -->
<!-- /query -->

<!-- #use [[!someplace/template/blabla]] -->
<!-- /use -->

<!-- #include [[!someplace/template/blabla]] -->
<!-- /include -->
`;

Deno.test("Test link translation", () => {
  const lang = wikiMarkdownLang([]);
  let tree = parse(lang, page);
  // Translate all page refs
  translateLinksWithPrefix(tree, "!someplace/");
  const newPage = renderToText(tree);
  assertEquals(newPage, expectedPage);

  tree = parse(lang, newPage);
  // And remove them again
  translateLinksWithoutPrefix(tree, "!someplace/");
  assertEquals(renderToText(tree), page);
});
