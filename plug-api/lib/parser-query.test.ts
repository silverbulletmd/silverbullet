import { parse } from "$common/markdown_parser/parse_tree.ts";
import { AST, collectNodesOfType, parseTreeToAST } from "./tree.ts";
import { assert, assertEquals } from "$std/testing/asserts.ts";
import { astToKvQuery } from "$sb/lib/parse-query.ts";
import { languageFor } from "$common/languages.ts";

function wrapQueryParse(query: string): AST | null {
  const tree = parse(languageFor("query")!, query);
  // console.log("tree", tree);
  // Check for no ambiguitiies
  if (collectNodesOfType(tree, "⚠").length > 0) {
    console.error("Parse error:", JSON.stringify(tree, null, 2));
    assert(false);
  }

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
    astToKvQuery(wrapQueryParse(`page where .`)!),
    {
      querySource: "page",
      filter: ["attr"],
    },
  );

  assertEquals(
    astToKvQuery(wrapQueryParse(`page where name = "hello"`)!),
    {
      querySource: "page",
      filter: ["=", ["attr", "name"], [
        "string",
        "hello",
      ]],
    },
  );

  assertEquals(
    astToKvQuery(wrapQueryParse("page where `name`")!),
    {
      querySource: "page",
      filter: ["attr", "name"],
    },
  );

  assertEquals(
    astToKvQuery(wrapQueryParse("page where `something`.`name`")!),
    {
      querySource: "page",
      filter: ["attr", ["attr", "something"], "name"],
    },
  );

  assertEquals(
    astToKvQuery(wrapQueryParse("page select 10 as `something`, `name`")!),
    {
      querySource: "page",
      select: [{ name: "something", expr: ["number", 10] }, { name: "name" }],
    },
  );

  assertEquals(
    astToKvQuery(wrapQueryParse(`page where @page`)!),
    {
      querySource: "page",
      filter: ["global", "page"],
    },
  );

  // Comment check
  assertEquals(
    astToKvQuery(
      wrapQueryParse(`page # comment`)!,
    ),
    {
      querySource: "page",
    },
  );

  // Nested query check

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`page select {page} as p`)!,
    ),
    {
      querySource: "page",
      select: [{
        expr: ["query", { querySource: "page" }],
        name: "p",
      }],
    },
  );

  assertEquals(
    astToKvQuery(wrapQueryParse(`page where not true`)!),
    {
      querySource: "page",
      filter: ["not", ["boolean", true]],
    },
  );

  assertEquals(
    astToKvQuery(wrapQueryParse(`page where !isSomething`)!),
    {
      querySource: "page",
      filter: ["not", ["attr", "isSomething"]],
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
      wrapQueryParse(`page where name = [[my page]]`)!,
    ),
    {
      querySource: "page",
      filter: ["=", ["attr", "name"], [
        "pageref",
        "my page",
      ]],
    },
  );

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`page where name = {"name": "Pete", "age": 27}`)!,
    ),
    {
      querySource: "page",
      filter: ["=", ["attr", "name"], ["object", [
        ["name", ["string", "Pete"]],
        ["age", ["number", 27]],
      ]]],
    },
  );

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`page where json({})`)!,
    ),
    {
      querySource: "page",
      filter: ["call", "json", [["object", []]]],
    },
  );

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`page where name = [1, 2, 3]`)!,
    ),
    {
      querySource: "page",
      filter: ["=", ["attr", "name"], ["array", [["number", 1], ["number", 2], [
        "number",
        3,
      ]]]],
    },
  );

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`page where name = []`)!,
    ),
    {
      querySource: "page",
      filter: ["=", ["attr", "name"], ["array", []]],
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
      wrapQueryParse(`task where myCall().thing`)!,
    ),
    {
      querySource: "task",
      filter: ["attr", ["call", "myCall", []], "thing"],
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

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`page select 8 > 3 ? "yes" : "no" as truth`)!,
    ),
    {
      querySource: "page",
      select: [{
        name: "truth",
        expr: ["?", [">", ["number", 8], ["number", 3]], ["string", "yes"], [
          "string",
          "no",
        ]],
      }],
    },
  );

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`page where myCall(-3) > 4 - 2`)!,
    ),
    {
      querySource: "page",
      filter: [">", ["call", "myCall", [["-", ["number", 3]]]], ["-", [
        "number",
        4,
      ], ["number", 2]]],
    },
  );

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`page where 1 * 2 - 3`)!,
    ),
    {
      querySource: "page",
      filter: ["-", ["*", ["number", 1], ["number", 2]], ["number", 3]],
    },
  );

  assertEquals(
    astToKvQuery(
      wrapQueryParse(`page where 1*-2`)!,
    ),
    {
      querySource: "page",
      filter: ["*", ["number", 1], ["-", ["number", 2]]],
    },
  );
});
