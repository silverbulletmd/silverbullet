import { assertEquals } from "../../test_deps.ts";
import { applyQuery } from "$sb/lib/query.ts";

import wikiMarkdownLang from "../../common/markdown_parser/parser.ts";
import { parse } from "../../common/markdown_parser/parse_tree.ts";
import { parseQuery as parseQueryQuery } from "./parser.ts";
import { findNodeOfType, renderToText } from "../../plug-api/lib/tree.ts";

function parseQuery(query: string) {
  const lang = wikiMarkdownLang([]);
  const mdTree = parse(
    lang,
    `<!-- #query ${query} -->
  
  <!-- /query -->`,
  );
  const programNode = findNodeOfType(mdTree, "Program")!;
  return parseQueryQuery(programNode);
}

Deno.test("Test parser", () => {
  const parsedBasicQuery = parseQuery(`page`);
  assertEquals(parsedBasicQuery.table, "page");

  const parsedQuery1 = parseQuery(
    `task where completed = false and dueDate <= "{{today}}" order by dueDate desc limit 5`,
  );
  assertEquals(parsedQuery1.table, "task");
  assertEquals(parsedQuery1.ordering.length, 1);
  assertEquals(parsedQuery1.ordering[0].orderBy, "dueDate");
  assertEquals(parsedQuery1.ordering[0].orderDesc, true);
  assertEquals(parsedQuery1.limit, 5);
  assertEquals(parsedQuery1.filter.length, 2);
  assertEquals(parsedQuery1.filter[0], {
    op: "=",
    prop: "completed",
    value: false,
  });
  assertEquals(parsedQuery1.filter[1], {
    op: "<=",
    prop: "dueDate",
    value: "{{today}}",
  });

  const parsedQuery2 = parseQuery(`page where name =~ /interview\\/.*/"`);
  assertEquals(parsedQuery2.table, "page");
  assertEquals(parsedQuery2.filter.length, 1);
  assertEquals(parsedQuery2.filter[0], {
    op: "=~",
    prop: "name",
    value: "interview\\/.*",
  });

  const parsedQuery3 = parseQuery(`page where something != null`);
  assertEquals(parsedQuery3.table, "page");
  assertEquals(parsedQuery3.filter.length, 1);
  assertEquals(parsedQuery3.filter[0], {
    op: "!=",
    prop: "something",
    value: null,
  });

  assertEquals(parseQuery(`page select name`).select, ["name"]);
  assertEquals(parseQuery(`page select name, age`).select, [
    "name",
    "age",
  ]);

  assertEquals(
    parseQuery(`gh-events where type in ["PushEvent", "somethingElse"]`),
    {
      table: "gh-events",
      ordering: [],
      filter: [
        {
          op: "in",
          prop: "type",
          value: ["PushEvent", "somethingElse"],
        },
      ],
    },
  );

  assertEquals(parseQuery(`something render [[template/table]]`), {
    table: "something",
    ordering: [],
    filter: [],
    render: "template/table",
  });

  assertEquals(parseQuery(`something render "template/table"`), {
    table: "something",
    ordering: [],
    filter: [],
    render: "template/table",
  });
});

Deno.test("Test applyQuery", () => {
  const data: any[] = [
    { name: "interview/My Interview", lastModified: 1 },
    { name: "interview/My Interview 2", lastModified: 2 },
    { name: "Pete", age: 38 },
    { name: "Angie", age: 28 },
  ];

  assertEquals(
    applyQuery(parseQuery(`page where name =~ /interview\\/.*/`), data),
    [
      { name: "interview/My Interview", lastModified: 1 },
      { name: "interview/My Interview 2", lastModified: 2 },
    ],
  );
  assertEquals(
    applyQuery(
      parseQuery(`page where name =~ /interview\\/.*/ order by lastModified`),
      data,
    ),
    [
      { name: "interview/My Interview", lastModified: 1 },
      { name: "interview/My Interview 2", lastModified: 2 },
    ],
  );
  assertEquals(
    applyQuery(
      parseQuery(
        `page where name  =~ /interview\\/.*/ order by lastModified desc`,
      ),
      data,
    ),
    [
      { name: "interview/My Interview 2", lastModified: 2 },
      { name: "interview/My Interview", lastModified: 1 },
    ],
  );
  assertEquals(applyQuery(parseQuery(`page where age > 30`), data), [
    { name: "Pete", age: 38 },
  ]);
  assertEquals(
    applyQuery(parseQuery(`page where age > 28 and age < 38`), data),
    [],
  );
  assertEquals(
    applyQuery(parseQuery(`page where age > 30 select name`), data),
    [{ name: "Pete" }],
  );

  assertEquals(
    applyQuery(parseQuery(`page where name in ["Pete"] select name`), data),
    [{ name: "Pete" }],
  );
});

Deno.test("Test applyQuery with multi value", () => {
  const data: any[] = [
    { name: "Pete", children: ["John", "Angie"] },
    { name: "Angie", children: ["Angie"] },
    { name: "Steve" },
  ];

  assertEquals(
    applyQuery(parseQuery(`page where children = "Angie"`), data),
    [
      { name: "Pete", children: ["John", "Angie"] },
      { name: "Angie", children: ["Angie"] },
    ],
  );

  assertEquals(
    applyQuery(parseQuery(`page where children = ["Angie", "John"]`), data),
    [
      { name: "Pete", children: ["John", "Angie"] },
      { name: "Angie", children: ["Angie"] },
    ],
  );
});

const testQuery = `<!-- #query source where a = 1 and b = "2" and c = "3" -->

<!-- /query -->`;

Deno.test("Query parsing and serialization", () => {
  const lang = wikiMarkdownLang([]);
  const mdTree = parse(lang, testQuery);
  // console.log(JSON.stringify(mdTree, null, 2));
  assertEquals(renderToText(mdTree), testQuery);
});
