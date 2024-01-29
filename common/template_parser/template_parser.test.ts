import { collectNodesOfType, ParseTree } from "../../plug-api/lib/tree.ts";
import { assertEquals } from "../../test_deps.ts";
import { parseTemplate } from "./template_parser.ts";

Deno.test("Test template", () => {
  let tree = parseTemplate(`{{.}}`);

  tree = parseTemplate(`
  # My template
  {{#each .}}
  * Page: {{name}}
  {{#if somethingComplicated(something)}}
  Sup
  {{/if}}
  {{/each}}

  {{#query page limit 3}}
  * {{name}}
  {{/query}}
  `);

  assertNoAmbs(tree);

  console.log(JSON.stringify(tree, null, 2));
});

function assertNoAmbs(tree: ParseTree) {
  assertEquals(findAmbs(tree).length, 0);
}

function findAmbs(tree: ParseTree) {
  return collectNodesOfType(tree, "⚠");
}
