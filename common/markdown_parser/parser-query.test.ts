import { parse } from "./parse_tree.ts";
import buildMarkdown from "./parser.ts";
import {
  findNodeOfType,
  ParseTree,
  renderToText,
} from "../../plug-api/lib/tree.ts";
import { assertEquals } from "../../test_deps.ts";
import { parseTreeToKvQuery } from "./parse-query.ts";
import { assert } from "https://deno.land/std@0.189.0/_util/asserts.ts";

const lang = buildMarkdown([]);

function wrapQueryParse(query: string): ParseTree | null {
  const tree = parse(lang, `<!-- #query ${query} -->\n$\n<!-- /query -->`);
  return findNodeOfType(tree, "Query");
}

Deno.test("Test directive parser", () => {
  // const query = ;
  // console.log("query", query);
  assertEquals(
    parseTreeToKvQuery(wrapQueryParse(`page where name = "test"`)!),
    {
      prefix: ["page"],
      filter: ["=", ["attr", "name"], ["string", "test"]],
    },
  );

  assertEquals(
    parseTreeToKvQuery(wrapQueryParse(`page where parent.name = "test"`)!),
    {
      prefix: ["page"],
      filter: ["=", ["attr", "parent.name"], ["string", "test"]],
    },
  );

  assertEquals(
    parseTreeToKvQuery(
      wrapQueryParse(`page where name = "test" and age > 20`)!,
    ),
    {
      prefix: ["page"],
      filter: ["and", ["=", ["attr", "name"], ["string", "test"]], [">", [
        "attr",
        "age",
      ], ["number", 20]]],
    },
  );

  assertEquals(
    parseTreeToKvQuery(
      wrapQueryParse(`page where name = "test" and age > 20 or done = true`)!,
    ),
    {
      prefix: ["page"],
      filter: ["or", ["and", ["=", ["attr", "name"], ["string", "test"]], [
        ">",
        [
          "attr",
          "age",
        ],
        ["number", 20],
      ]], ["=", ["attr", "done"], ["boolean", true]]],
    },
  );
});
