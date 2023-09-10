import { parse } from "./parse_tree.ts";
import buildMarkdown from "./parser.ts";
import {
  AST,
  findNodeOfType,
  parseTreeToAST,
} from "../../plug-api/lib/tree.ts";
import { assertEquals } from "../../test_deps.ts";
import { astToKvQuery } from "./parse-query.ts";

const lang = buildMarkdown([]);

function wrapQueryParse(query: string): AST | null {
  const tree = parse(lang, `<!-- #query ${query} -->\n$\n<!-- /query -->`);
  return parseTreeToAST(findNodeOfType(tree, "Query")!);
}

Deno.test("Test directive parser", () => {
  // const query = ;
  // console.log("query", query);
  assertEquals(
    astToKvQuery(wrapQueryParse(`page where name = "test"`)!),
    {
      prefix: ["page"],
      filter: ["=", ["attr", "name"], ["string", "test"]],
    },
  );

  assertEquals(
    astToKvQuery(wrapQueryParse(`page where parent.name = "test"`)!),
    {
      prefix: ["page"],
      filter: ["=", ["attr", ["attr", "parent"], "name"], ["string", "test"]],
    },
  );

  assertEquals(
    astToKvQuery(
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
    astToKvQuery(
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
