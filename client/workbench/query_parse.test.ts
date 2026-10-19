import { describe, expect, test } from "vitest";
import { addGroupKey } from "./query_edits.ts";
import { inferFields } from "./query_fields.ts";
import { sourceFor } from "./query_from.ts";
import { emptyModel, type QueryModel } from "./query_model.ts";
import type { FieldFilter } from "./query_ops.ts";
import { parseQuery, querySource } from "./query_parse.ts";
import { generateQuery } from "./query_text.ts";

// Made-up objects, enough to type each field
const taskFields = inferFields(
  [
    {
      name: "Send report",
      done: false,
      due: "2026-10-21",
      page: "[[Work/Reports]]",
      tags: ["work"],
      priority: 2,
      lastModified: "2026-10-15T10:00:00",
      "due date": "2026-10-21",
    },
    {
      name: "Renew passport",
      done: true,
      due: "2026-11-14",
      page: "[[Home/Admin]]",
      tags: ["home"],
      priority: 1,
      lastModified: "2026-10-16T10:00:00",
      "due date": "2026-10-22",
    },
  ],
  null,
  false,
);
const bookFields = inferFields(
  [
    { title: "Piranesi", status: "finished", rating: 4 },
    { title: "Klara and the Sun", status: "finished", rating: 3 },
    { title: "The Overstory", status: "reading" },
    { title: "The Dispossessed", status: "reading" },
  ],
  null,
  false,
);

const ff = (field: string, op: string, values: string[] = []): FieldFilter => ({
  kind: "field",
  field,
  op,
  values,
});

function task(patch: Partial<QueryModel> = {}): QueryModel {
  return { ...emptyModel(sourceFor("task"), taskFields), ...patch };
}

function grouped(): QueryModel {
  let m = addGroupKey(emptyModel(sourceFor("book"), bookFields), "status");
  m = {
    ...m,
    groupColumns: [
      ...m.groupColumns,
      {
        id: "n",
        header: "Books",
        kind: "agg",
        agg: "count",
        field: "title",
        sorted: false,
      },
      {
        id: "r",
        header: "Rated",
        kind: "agg",
        agg: "count",
        field: "title",
        sorted: false,
        where: "b.rating ~= nil",
      },
      {
        id: "t",
        header: "Titles",
        kind: "agg",
        agg: "array_agg",
        field: "title",
        sorted: true,
      },
    ],
    sorts: [{ by: { kind: "column", id: "n" }, desc: true }],
    limit: 2,
  };
  return m;
}

/** Parses `m`'s text and generates it again: a faithful parse gives the same text */
function roundTrip(m: QueryModel, fields = taskFields) {
  const text = generateQuery(m, fields, { wrap: false });
  const parsed = parseQuery(text, fields);
  if (!parsed.ok) throw new Error(parsed.reason);
  expect(generateQuery(parsed.model, fields, { wrap: false })).toBe(text);
  return parsed;
}

describe("round trip of generated queries", () => {
  test("the default table", () => {
    roundTrip(task());
  });

  test("every operator of every type", () => {
    const filters = [
      ff("done", "true"),
      ff("done", "false"),
      ff("name", "is", ["Send report"]),
      ff("name", "isnot", ["x"]),
      ff("name", "contains", ["rep"]),
      ff("name", "starts", ["Se"]),
      ff("name", "oneof", ["a", "b"]),
      ff("name", "empty"),
      ff("priority", "eq", ["2"]),
      ff("priority", "ge", ["1"]),
      ff("priority", "between", ["1", "3"]),
      ff("due", "before", ["2026-11-01"]),
      ff("due", "on", ["2026-10-21"]),
      ff("due", "between", ["2026-10-01", "2026-11-01"]),
      ff("due", "beforetoday"),
      ff("lastModified", "on", ["2026-10-15"]),
      ff("tags", "contains", ["work"]),
      ff("tags", "any", ["work", "home"]),
      ff("tags", "empty"),
      ff("page", "is", ["Work/Reports"]),
      ff("due", "exists"),
      ff("due", "missing"),
    ];
    for (const f of filters) {
      const parsed = roundTrip(task({ filters: [ff("done", "false"), f] }));
      expect(parsed.model.filters[1], f.op).toEqual(f);
    }
  });

  test("nested fields", () => {
    const fields = inferFields(
      [{ name: "a" }, { name: "b", meta: { prefix: "x" } }],
      null,
      false,
    );
    const m: QueryModel = {
      ...emptyModel(sourceFor("note"), fields),
      filters: [ff("meta.prefix", "is", ["x"])],
      sorts: [{ by: { kind: "field", field: "meta.prefix" }, desc: false }],
    };
    const parsed = roundTrip(addGroupKey(m, "meta.prefix"), fields);
    expect(parsed.model.group).toEqual(["meta.prefix"]);
    expect(parsed.model.filters).toEqual([ff("meta.prefix", "is", ["x"])]);
    // Written the plain way by hand, it's still the field
    const plain = parseQuery(
      'query[[from n = index.tag "note" order by n.meta.prefix]]',
      fields,
    );
    expect(plain.ok && plain.model.sorts[0].by).toEqual({
      kind: "field",
      field: "meta.prefix",
    });
  });

  test("expression filters, with and without or", () => {
    const parsed = roundTrip(
      task({
        filters: [
          { kind: "expr", expr: 't.name:startsWith("Work/")' },
          { kind: "expr", expr: "t.done or t.due == nil" },
        ],
      }),
    );
    expect(parsed.model.filters[1]).toEqual({
      kind: "expr",
      expr: "t.done or t.due == nil",
    });
  });

  test("sorts, columns, links and the limit", () => {
    const parsed = roundTrip(
      task({
        sorts: [
          { by: { kind: "field", field: "due" }, desc: false, nulls: "last" },
          { by: { kind: "expr", lua: "#t.tags" }, desc: true },
        ],
        select: {
          mode: "table",
          columns: [
            { id: "1", header: "Task", kind: "field", value: "name" },
            { id: "2", header: "Due date", kind: "field", value: "due date" },
            { id: "3", header: "Page", kind: "link", value: "page" },
            { id: "4", header: "Tags", kind: "expr", value: "#t.tags" },
          ],
        },
        limit: 5,
      }),
    );
    expect(
      parsed.model.select.mode === "table" &&
        parsed.model.select.columns.map((c) => [c.kind, c.value]),
    ).toEqual([
      ["field", "name"],
      ["field", "due date"],
      ["link", "page"],
      ["expr", "#t.tags"],
    ]);
  });

  test("list templates, built-in and custom", () => {
    roundTrip(
      task({
        select: { mode: "list", list: { template: "templates.taskItem" } },
      }),
    );
    const parsed = roundTrip(
      task({
        select: { mode: "list", list: { custom: "* [[${name}]] due ${due}" } },
      }),
    );
    expect(parsed.model.select).toEqual({
      mode: "list",
      list: { custom: "* [[${name}]] due ${due}" },
    });
  });

  test("grouped: keys, aggregates, only where, sorted, ordered by a column", () => {
    const parsed = roundTrip(grouped(), bookFields);
    expect(parsed.model.group).toEqual(["status"]);
    expect(parsed.model.groupColumns.map((c) => c.kind)).toEqual([
      "key",
      "agg",
      "agg",
      "agg",
    ]);
  });

  test("grouped by two keys, ordered by the second", () => {
    let m = addGroupKey(grouped(), "rating");
    m = {
      ...m,
      sorts: [{ by: { kind: "groupKey", field: "rating" }, desc: true }],
    };
    roundTrip(m, bookFields);
  });
});

describe("hand-written queries", () => {
  test("another variable name is kept", () => {
    const parsed = parseQuery(
      'query[[from x = index.tag "task" where not x.done order by x.due select { Task = x.name }]]',
      taskFields,
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.model.binding).toBe("x");
    expect(parsed.model.filters).toEqual([ff("done", "false")]);
    expect(parsed.model.sorts).toEqual([
      { by: { kind: "field", field: "due" }, desc: false },
    ]);
    // The older index.tag form comes back as the root tag's helper
    expect(generateQuery(parsed.model, taskFields)).toContain(
      "from x = index.tasks()",
    );
  });

  test("a query without a variable keeps that form", () => {
    const text =
      'query[[from index.tag "task" where done select { n = name }]]';
    const parsed = parseQuery(text, taskFields);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.model.binding).toBe(null);
    // Bare names can't be told from globals, so they stay expressions
    expect(parsed.model.filters).toEqual([{ kind: "expr", expr: "done" }]);
    expect(generateQuery(parsed.model, taskFields, { wrap: false })).toBe(
      [
        "query[[",
        "  from index.tasks()",
        "  where done",
        "  select {",
        "    n = name",
        "  }",
        "]]",
      ].join("\n"),
    );
  });

  test("any templates.x the space defines is a list template", () => {
    const parsed = parseQuery(
      'query[[from t = index.tag "task" select templates.myOwnLine(t)]]',
      taskFields,
    );
    expect(parsed.ok && parsed.model.select).toEqual({
      mode: "list",
      list: { template: "templates.myOwnLine" },
    });
  });

  test("the ${} around a directive is allowed", () => {
    const parsed = parseQuery(
      '${query[[from t = index.tag "task"]]}',
      taskFields,
    );
    expect(parsed.ok).toBe(true);
  });

  test("a query without select gets every field as a column, and says so", () => {
    const parsed = parseQuery('query[[from t = index.tag "task"]]', taskFields);
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.model.select.mode).toBe("table");
    expect(parsed.notes).toEqual([
      "The query had no select, so every field is a column",
    ]);
  });

  test("a guard written in another order is an expression, not lost", () => {
    const parsed = parseQuery(
      'query[[from t = index.tag "task" where t.due < "2026-11-01" and type(t.due) == "string"]]',
      taskFields,
    );
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(generateQuery(parsed.model, taskFields, { wrap: false })).toContain(
      'where t.due < "2026-11-01"\n    and type(t.due) == "string"',
    );
  });

  test("what the builder can't show is refused with a reason", () => {
    const cases: [string, RegExp][] = [
      ["1 + 1", /isn't a query/],
      ["query[[from t = index.tag 'task' where]]", /doesn't parse/],
      ["query[[from t = myObjects where t.x]]", /index\.\*/],
      ['query[[from t = index.tag "task" limit 5 offset 10]]', /offset/],
      ['query[[from t = index.tag "task" group by t.name:sub(1, 1)]]', /group/],
      ['query[[from t = index.tag "task" select t.name]]', /select/],
      [
        'query[[from t = index.tag "task" group by t.done having count(t.name) > 1]]',
        /having/,
      ],
    ];
    for (const [text, reason] of cases) {
      const parsed = parseQuery(text, taskFields);
      expect(parsed.ok, text).toBe(false);
      if (!parsed.ok) expect(parsed.reason, text).toMatch(reason);
    }
  });
});

describe("querySource", () => {
  test("the source a query reads, or null", () => {
    expect(querySource("query[[from p = index.pages()]]")).toEqual(
      sourceFor("page"),
    );
    expect(querySource('query[[from t = index.tasks("work")]]')).toEqual({
      root: "task",
      tag: "work",
      by: "root",
    });
    expect(querySource('query[[from index.data("contact")]]')).toEqual({
      root: "data",
      tag: "contact",
      by: "root",
    });
    expect(querySource('query[[from r = index.relations("spouse")]]')).toEqual({
      root: "relation",
      tag: "spouse",
      by: "root",
    });
    expect(querySource("query[[from d = index.documents()]]")).toEqual(
      sourceFor("document"),
    );
    expect(querySource('query[[from o = index.objects("book")]]')).toEqual(
      sourceFor("book"),
    );
    expect(querySource("1 + 1")).toBe(null);
    expect(querySource('query[[from d = index.documents("x")]]')).toBe(null);
    expect(querySource("query[[from p = index.contentPages()]]")).toBe(null);
  });

  test("the older index.tag form still opens", () => {
    expect(querySource('query[[from b = index.tag "book" limit 1]]')).toEqual(
      sourceFor("book"),
    );
    expect(querySource('${query[[from index.tag "page"]]}')).toEqual(
      sourceFor("page"),
    );
  });
});
