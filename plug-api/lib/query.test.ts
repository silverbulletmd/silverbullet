import { renderToText } from "./tree.ts";
import { assert, assertEquals } from "../../test_deps.ts";
import { removeQueries } from "./query.ts";
import { parseMarkdown } from "$sb/lib/test_utils.ts";

const queryRemovalTest = `
# Heading
Before
<!-- #query page -->
Bla bla remove me
<!-- /query -->
End
`;

Deno.test("White out queries", () => {
  const mdTree = parseMarkdown(queryRemovalTest);
  removeQueries(mdTree);
  const text = renderToText(mdTree);
  // Same length? We should be good
  assertEquals(text.length, queryRemovalTest.length);
  assert(text.indexOf("remove me") === -1);
  console.log("Whited out text", text);
});
