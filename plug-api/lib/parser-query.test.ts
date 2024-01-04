import { parse } from "../../common/markdown_parser/parse_tree.ts";
import { AST, parseTreeToAST } from "$sb/lib/tree.ts";
import { assertEquals } from "../../test_deps.ts";
import { astToKvQuery } from "$sb/lib/parse-query.ts";
import { languageFor } from "../../common/languages.ts";

function wrapQueryParse(query: string): AST | null {
  const tree = parse(languageFor("query")!, query);
  // console.log("tree", tree);
  return parseTreeToAST(tree.children![0]);
}

Deno.test("Test query parser", () => {
  // const query = ;
  // console.log("query", query);
  assertEquals(
    astToKvQuery(wrapQueryParse(`page where name = "test"`)!),
    {
      querySource: "page",
      filter: ["=", ["attr", "name"], ["string", "test"]],
    },
  );

  assertEquals(
    astToKvQuery(wrapQueryParse(`page where true`)!),
    {
      querySource: "page",
      filter: ["boolean", true],
    },
  );

  assertEquals(
    astToKvQuery(wrapQueryParse(`page where name =~ /test/`)!),
    {
      querySource: "page",
      filter: ["=~", ["attr", "name"], ["regexp", "test", "i"]],
    },
  );

  assertEquals(
    astToKvQuery(wrapQueryParse(`page where parent.name = "test"`)!),
    {
      querySource: "page",
      filter: ["=", ["attr", ["attr", "parent"], "name"], ["string", "test"]],
    },
  );

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`page where name = "test" and age > 20`)!,
    ),
    {
      querySource: "page",
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
      querySource: "page",
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

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`page where (age <= 20) or task.done = null`)!,
    ),
    {
      querySource: "page",
      filter: ["or", ["<=", ["attr", "age"], ["number", 20]], [
        "=",
        [
          "attr",
          [
            "attr",
            "task",
          ],
          "done",
        ],
        ["null"],
      ]],
    },
  );

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`task order by lastModified asc`)!,
    ),
    {
      querySource: "task",
      orderBy: [{ expr: ["attr", "lastModified"], desc: false }],
    },
  );
  assertEquals(
    astToKvQuery(
      wrapQueryParse(`task order by lastModified`)!,
    ),
    {
      querySource: "task",
      orderBy: [{ expr: ["attr", "lastModified"], desc: false }],
    },
  );
  assertEquals(
    astToKvQuery(
      wrapQueryParse(`task order by lastModified desc, name, age asc`)!,
    ),
    {
      querySource: "task",
      orderBy: [{ expr: ["attr", "lastModified"], desc: true }, {
        expr: ["attr", "name"],
        desc: false,
      }, { expr: ["attr", "age"], desc: false }],
    },
  );
  assertEquals(
    astToKvQuery(
      wrapQueryParse(`task order by lastModified desc limit 5`)!,
    ),
    {
      querySource: "task",
      orderBy: [{ expr: ["attr", "lastModified"], desc: true }],
      limit: ["number", 5],
    },
  );
  assertEquals(
    astToKvQuery(
      wrapQueryParse(`task select name, lastModified + 20 as modified`)!,
    ),
    {
      querySource: "task",
      select: [{ name: "name" }, {
        name: "modified",
        expr: ["+", ["attr", "lastModified"], ["number", 20]],
      }],
    },
  );

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`task render [[my/page]]`)!,
    ),
    {
      querySource: "task",
      render: "my/page",
      renderAll: false,
    },
  );

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`task render each [[my/page]]`)!,
    ),
    {
      querySource: "task",
      render: "my/page",
      renderAll: false,
    },
  );

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`task render all [[my/page]]`)!,
    ),
    {
      querySource: "task",
      render: "my/page",
      renderAll: true,
    },
  );

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`task where name in ["hello", 1]`)!,
    ),
    {
      querySource: "task",
      filter: ["in", ["attr", "name"], ["array", [["string", "hello"], [
        "number",
        1,
      ]]]],
    },
  );

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`task select today() as today2`)!,
    ),
    {
      querySource: "task",
      select: [{
        name: "today2",
        expr: ["call", "today", []],
      }],
    },
  );

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`task select today(1, 2, 3) as today`)!,
    ),
    {
      querySource: "task",
      select: [{
        name: "today",
        expr: ["call", "today", [["number", 1], ["number", 2], ["number", 3]]],
      }],
    },
  );
});
