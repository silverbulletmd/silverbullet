import { assertEquals } from "../../test_deps.ts";
import { parse } from "../../common/markdown_parser/parse_tree.ts";
import wikiMarkdownLang from "../../common/markdown_parser/parser.ts";
import { translatePageLinks } from "./translate.ts";
import { renderToText } from "$sb/lib/tree.ts";

const page = `
Hello there, here's a link to a [[../some-page]]. And here's a link to a [[!federated.com/page]].

I'm also going to use a query!

<!-- #query page render [[page]] -->
<!-- /query -->

<!-- #query page render [[!federated.com/template/page]] -->
<!-- /query -->

<!-- #use [[blabla]] -->
<!-- /use -->

<!-- #include [[blabla]] -->
<!-- /include -->
`;

const expectedPage = `
Hello there, here's a link to a [[../some-page]]. And here's a link to a [[!federated.com/page]].

I'm also going to use a query!

<!-- #query page render [[../template/page]] -->
<!-- /query -->

<!-- #query page render [[!federated.com/template/page]] -->
<!-- /query -->

<!-- #use [[../template/blabla]] -->
<!-- /use -->

<!-- #include [[../template/blabla]] -->
<!-- /include -->
`;

Deno.test("Test link translation", () => {
  const lang = wikiMarkdownLang([]);
  const tree = parse(lang, page);
  // Translate all page refs
  translatePageLinks("template/my-template", "page/my-page", tree);
  const newPage = renderToText(tree);
  assertEquals(newPage, expectedPage);
});
