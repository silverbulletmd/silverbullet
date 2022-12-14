import { renderToText } from "./tree.ts";
import wikiMarkdownLang from "../../common/markdown_parser/parser.ts";
import { assert, assertEquals } from "../../test_deps.ts";
import { parse } from "../../common/markdown_parser/parse_tree.ts";
import { removeQueries } from "./query.ts";

const queryRemovalTest = `
# Heading
Before
<!-- #query page -->
Bla bla remove me
<!-- /query -->
End
`;

Deno.test("White out queries", () => {
  const lang = wikiMarkdownLang([]);
  const mdTree = parse(lang, queryRemovalTest);
  removeQueries(mdTree);
  const text = renderToText(mdTree);
  // Same length? We should be good
  assertEquals(text.length, queryRemovalTest.length);
  assert(text.indexOf("remove me") === -1);
  console.log("Whited out text", text);
});
