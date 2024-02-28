import { assertEquals } from "$std/testing/asserts.ts";
import { parseTemplate } from "./template_parser.ts";

Deno.test("Test template", () => {
  assertEquals(parseTemplate(`{{.}}`), ["Template", ["TemplateElement", [
    "ExpressionDirective",
    [
      "Expression",
      ["TopLevelVal", "."],
    ],
  ]]]);

  assertEquals(parseTemplate(`{{{page}}}`), ["Template", ["TemplateElement", [
    "ExpressionDirective",
    ["Expression", ["QueryExpression", "{", ["Query", [
      "TagIdentifier",
      "page",
    ]], "}"]],
  ]]]);

  assertEquals(parseTemplate(`{{escapeRegexp @page.name}}`), ["Template", [
    "TemplateElement",
    ["ExpressionDirective", ["Expression", [
      "Call",
      ["Identifier", "escapeRegexp"],
      "(",
      ["Expression", [
        "Attribute",
        [
          "Expression",
          ["GlobalIdentifier", "@page"],
        ],
        ".",
        [
          "Identifier",
          "name",
        ],
      ]],
      ")",
    ]]],
  ]]);

  const tree = parseTemplate(`
  # My template
  {{#each .}}
  * Page: {{name}}
  {{#if somethingComplicated(something)}}
  Sup
  {{else}}
  Not sup
  {{/if}}
  {{/each}}
  `);

  console.log(JSON.stringify(tree, null, 2));
});
