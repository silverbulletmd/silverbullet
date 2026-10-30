import { beforeAll, describe, expect, test } from "vitest";
import { evalExpression } from "../../space_lua/eval.ts";
import { parseExpressionString } from "../../space_lua/parse.ts";
import {
  jsToLuaValue,
  LuaEnv,
  LuaStackFrame,
  LuaTable,
  luaValueToJS,
} from "../../space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../../space_lua/stdlib.ts";
import {
  type AttributeInfo,
  inferAttributes,
  tableKey,
} from "./query_attributes.ts";
import { addGroupKey, removeGroupKey } from "./query_edits.ts";
import { sourceFor } from "./query_from.ts";
import {
  attributeAccess,
  bindingVar,
  emptyModel,
  type QueryModel,
} from "./query_model.ts";
import type { AttributeFilter } from "./query_ops.ts";
import { generateQuery } from "./query_text.ts";

// Made-up sample data, the same as the design prototype's
const TASKS = [
  {
    name: "Send quarterly report",
    done: false,
    page: "Work/Reports",
    due: "2026-10-21",
    tags: ["work"],
  },
  {
    name: "Book venue for offsite",
    done: false,
    page: "Work/Offsite",
    due: "2026-10-27",
    tags: ["work", "events"],
  },
  {
    name: "Review onboarding doc",
    done: false,
    page: "Work/Team",
    due: "2026-10-30",
    tags: ["work"],
  },
  {
    name: "Renew passport",
    done: false,
    page: "Home/Admin",
    due: "2026-11-14",
    tags: ["home"],
  },
  {
    name: "Fix bike brakes",
    done: false,
    page: "Home/Projects",
    tags: ["home"],
  },
  {
    name: "Draft talk outline",
    done: true,
    page: "Work/Talks",
    due: "2026-10-10",
    tags: ["work"],
  },
  {
    name: "Order birthday gift",
    done: false,
    page: "Home/Family",
    due: "2026-10-18",
    tags: ["home"],
  },
  {
    name: "Water the ferns",
    done: true,
    page: "Home/Garden",
    due: "2026-10-14",
    tags: [],
  },
  {
    name: "Update team wiki",
    done: false,
    page: "Work/Team",
    due: "2026-10-12",
    tags: ["work"],
  },
  {
    name: "Read chapter 4",
    done: false,
    page: "Books/Reading Log",
    tags: ["reading"],
  },
  {
    name: "Submit expense claims",
    done: false,
    page: "Work/Admin",
    due: "2026-10-24",
    tags: ["work", "admin"],
  },
  {
    name: "Plan winter garden",
    done: false,
    page: "Home/Garden",
    due: "2026-12-01",
    tags: ["home"],
  },
];
const BOOKS = [
  { title: "The Left Hand of Darkness", status: "finished", rating: 5 },
  { title: "Piranesi", status: "finished", rating: 4 },
  { title: "The Dispossessed", status: "reading" },
  { title: "Project Hail Mary", status: "finished", rating: 4 },
  { title: "Braiding Sweetgrass", status: "want" },
  { title: "The Overstory", status: "reading" },
  { title: "Klara and the Sun", status: "finished", rating: 3 },
  { title: "The Name of the Rose", status: "want" },
];
// Only some notes have a record attribute, like pages with pageDecoration
const NOTES = [
  { name: "Plain" },
  { name: "Decorated", meta: { prefix: "🌟", hidden: false } },
];
const FIXTURES: Record<string, Record<string, unknown>[]> = {
  task: TASKS,
  book: BOOKS,
  note: NOTES,
};

const taskAttributes = inferAttributes(
  TASKS,
  {
    name: { type: "text" },
    done: { type: "boolean" },
    page: { type: "pagelink" },
    tags: { type: "list" },
  },
  true,
);
const bookAttributes = inferAttributes(BOOKS, null, false);

const ff = (
  attribute: string,
  op: string,
  extra: Partial<AttributeFilter> = {},
) =>
  ({
    kind: "attribute",
    attribute,
    op,
    values: [],
    ...extra,
  }) as AttributeFilter;

function example1(): QueryModel {
  return {
    ...emptyModel(sourceFor("task"), taskAttributes),
    filters: [
      ff("done", "false"),
      ff("due", "before", { values: ["2026-11-01"] }),
    ],
    sorts: [{ by: { kind: "attribute", attribute: "due" }, desc: false }],
    select: {
      mode: "table",
      columns: [
        { id: "name", header: "Task", kind: "attribute", value: "name" },
        { id: "due", header: "Due date", kind: "attribute", value: "due" },
        { id: "page", header: "Page", kind: "link", value: "page" },
      ],
    },
    limit: 5,
  };
}

function grouped(): QueryModel {
  return {
    ...emptyModel(sourceFor("book"), bookAttributes),
    group: ["status"],
    sorts: [{ by: { kind: "groupKey", attribute: "status" }, desc: false }],
    groupColumns: [
      { id: "s", header: "Status", kind: "key", attribute: "status" },
      {
        id: "n",
        header: "Books",
        kind: "agg",
        agg: "count",
        attribute: "title",
        sorted: false,
      },
      {
        id: "r",
        header: "Avg rating",
        kind: "agg",
        agg: "avg",
        attribute: "rating",
        sorted: false,
      },
      {
        id: "t",
        header: "Titles",
        kind: "agg",
        agg: "array_agg",
        attribute: "title",
        sorted: true,
      },
    ],
  };
}

const unwrap = (text: string) => text.replace(/^\$\{/, "").replace(/\}$/, "");

async function run(text: string): Promise<any> {
  const env = new LuaEnv(luaBuildStandardEnv());
  const index = new LuaTable();
  const objects = (name: string) => jsToLuaValue(FIXTURES[name] ?? []);
  await index.set("objects", objects);
  await index.set("tasks", () => objects("task"));
  env.set("index", index);
  const expr = parseExpressionString(unwrap(text));
  const sf = LuaStackFrame.createWithGlobalEnv(env, expr.ctx);
  return luaValueToJS(await evalExpression(expr, env, sf), sf);
}

beforeAll(() => {
  // Aggregates read config through the global client
  (globalThis as any).client ??= {
    config: { get: (_k: string, fallback: unknown) => fallback ?? {} },
  };
});

describe("model helpers", () => {
  test("binding variable", () => {
    expect(bindingVar("task")).toBe("t");
    expect(bindingVar("book")).toBe("b");
    expect(bindingVar("2026-goals")).toBe("o");
  });

  test("attribute access quotes what isn't an identifier", () => {
    expect(attributeAccess("t", "due date")).toBe('t["due date"]');
    // A nested attribute reads its record first, so a missing record gives nil
    expect(attributeAccess("t", "meta.author")).toBe(
      "(t.meta and t.meta.author)",
    );
    expect(attributeAccess("t", "x-id")).toBe('t["x-id"]');
  });

  test("table keys", () => {
    expect(tableKey("Task")).toBe("Task");
    expect(tableKey("Due date")).toBe('["Due date"]');
  });

  test("default columns skip declared attributes no sampled object has", () => {
    const attributes = inferAttributes(
      [{ name: "Dashboard" }],
      { name: { type: "text" }, aliases: { type: "list" } },
      true,
    );
    const m = emptyModel(sourceFor("page"), attributes);
    expect(m.select).toEqual({
      mode: "table",
      columns: [
        {
          id: expect.any(String),
          header: "name",
          kind: "attribute",
          value: "name",
        },
      ],
    });
  });

  test("an empty model selects a column per non-system attribute, no limit", () => {
    const m = emptyModel(sourceFor("task"), [
      ...taskAttributes,
      { name: "ref", system: true } as AttributeInfo,
    ]);
    expect(m.select).toEqual({
      mode: "table",
      columns: taskAttributes
        .filter((f) => !f.system)
        .map((f) => ({
          id: expect.any(String),
          header: f.name,
          kind: "attribute",
          value: f.name,
        })),
    });
    expect(m.limit).toBe(null);
  });
});

describe("generateQuery", () => {
  test("example 1: open tasks due soon", () => {
    expect(generateQuery(example1(), taskAttributes)).toBe(
      [
        "${query[[",
        "  from t = index.tasks()",
        "  where not t.done",
        '    and type(t.due) == "string" and t.due < "2026-11-01"',
        "  order by t.due",
        "  limit 5",
        "  select {",
        "    Task = t.name,",
        '    ["Due date"] = t.due,',
        '    Page = "[[" .. t.page .. "]]"',
        "  }",
        "]]}",
      ].join("\n"),
    );
  });

  test("unwrapped text has no ${}", () => {
    const text = generateQuery(example1(), taskAttributes, { wrap: false });
    expect(text.startsWith("query[[")).toBe(true);
    expect(text.endsWith("]]")).toBe(true);
  });

  test("grouped queries use key and groupColumns", () => {
    const text = generateQuery(grouped(), bookAttributes);
    expect(text).toContain("group by b.status");
    expect(text).toContain("order by key");
    expect(text).toContain("Status = key,");
    expect(text).toContain('["Avg rating"] = avg(b.rating),');
    expect(text).toContain("Titles = array_agg(b.title order by b.title)");
  });

  test("with two group keys the second is key[2]", () => {
    const m = grouped();
    m.group = ["status", "rating"];
    m.groupColumns = [
      { id: "s", header: "Status", kind: "key", attribute: "status" },
      { id: "k", header: "Rating", kind: "key", attribute: "rating" },
    ];
    const text = generateQuery(m, bookAttributes);
    expect(text).toContain("group by b.status, b.rating");
    expect(text).toContain("Status = key[1],");
    expect(text).toContain("Rating = key[2]");
  });

  test("an aggregate may be limited with only where", () => {
    const m = grouped();
    m.groupColumns = [
      {
        id: "q",
        header: "Rated",
        kind: "agg",
        agg: "count",
        attribute: "title",
        sorted: false,
        where: "b.rating ~= nil",
      },
    ];
    expect(generateQuery(m, bookAttributes)).toContain(
      "Rated = count(b.title) filter(where b.rating ~= nil)",
    );
  });

  test("expression sorts and nulls placement are written as is", () => {
    const m = example1();
    m.sorts = [
      { by: { kind: "expr", lua: "#t.tags" }, desc: true },
      {
        by: { kind: "attribute", attribute: "due" },
        desc: false,
        nulls: "last",
      },
    ];
    expect(generateQuery(m, taskAttributes)).toContain(
      "order by #t.tags desc, t.due nulls last",
    );
  });

  test("an empty limit writes no limit clause", () => {
    const m = example1();
    m.limit = null;
    expect(generateQuery(m, taskAttributes)).not.toContain("limit");
  });

  test("list templates", () => {
    const m = example1();
    m.select = { mode: "list", list: { template: "templates.taskItem" } };
    expect(generateQuery(m, taskAttributes)).toContain(
      "select templates.taskItem(t)",
    );
  });

  test("a custom template with links still parses", () => {
    const m = emptyModel(sourceFor("book"), bookAttributes);
    m.select = {
      mode: "list",
      list: { custom: "* [[${title}]] by ${author}" },
    };
    const text = generateQuery(m, bookAttributes);
    expect(text).toContain(
      "select template.new[==[\n    * [[${title}]] by ${author}\n  ]==](b)",
    );
    expect(() => parseExpressionString(unwrap(text))).not.toThrow();
  });

  test("a custom template the double bracket can't hold gets another literal", () => {
    const m = emptyModel(sourceFor("book"), bookAttributes);
    m.select = { mode: "list", list: { custom: "* ${title} ]==]" } };
    const text = generateQuery(m, bookAttributes);
    expect(text).not.toContain("template.new[==[");
    expect(() => parseExpressionString(unwrap(text))).not.toThrow();
  });

  test("a custom template no long bracket fits becomes a quoted string", () => {
    const m = emptyModel(sourceFor("book"), bookAttributes);
    m.select = { mode: "list", list: { custom: "]] ]=] ]==] ${title}" } };
    const text = generateQuery(m, bookAttributes);
    expect(text).toContain('template.new("]] ]=] ]==] ${title}")(b)');
    expect(() => parseExpressionString(unwrap(text))).not.toThrow();
  });

  test("a value containing ]] still parses", () => {
    const m = example1();
    m.filters = [ff("name", "is", { values: ['Notes [[draft]] "x"'] })];
    const text = generateQuery(m, taskAttributes);
    expect(() => parseExpressionString(unwrap(text))).not.toThrow();
  });

  test("odd attribute names are quoted", () => {
    const attributes = inferAttributes(
      [{ "due date": "2026-10-21", meta: { author: "Sam" } }],
      null,
      false,
    );
    const m: QueryModel = {
      ...emptyModel(sourceFor("task"), attributes),
      filters: [ff("due date", "exists")],
      sorts: [
        { by: { kind: "attribute", attribute: "meta.author" }, desc: false },
      ],
    };
    const text = generateQuery(m, attributes);
    expect(text).toContain('where t["due date"] ~= nil');
    expect(text).toContain("order by (t.meta and t.meta.author)");
    expect(text).toContain('["due date"] = t["due date"]');
    expect(() => parseExpressionString(unwrap(text))).not.toThrow();
  });

  test("generated queries parse; an invalid expression filter is kept as is", () => {
    for (const m of [example1(), grouped()]) {
      const attributes =
        m.source.root === "task" ? taskAttributes : bookAttributes;
      expect(() =>
        parseExpressionString(unwrap(generateQuery(m, attributes))),
      ).not.toThrow();
    }
    const bad = example1();
    bad.filters = [{ kind: "expr", expr: "t.name ==" }];
    const text = generateQuery(bad, taskAttributes);
    expect(text).toContain("where t.name ==");
    expect(() => parseExpressionString(unwrap(text))).toThrow();
  });
});

describe("review fixes", () => {
  test("a filter with or keeps its meaning next to another filter", async () => {
    const m = example1();
    m.filters = [
      {
        kind: "expr",
        expr: 't.name == "Draft talk outline" or t.name == "Send quarterly report"',
      },
      ff("done", "false"),
    ];
    m.limit = null;
    const rows = await run(generateQuery(m, taskAttributes));
    expect(rows.map((r: any) => r.Task)).toEqual(["Send quarterly report"]);
  });

  test("an already parenthesized or isn't wrapped again", () => {
    const m = example1();
    m.filters = [
      ff("done", "false"),
      ff("tags", "any", { values: ["home", "work"] }),
    ];
    expect(generateQuery(m, taskAttributes)).toContain(
      '\n    and (table.includes(t.tags, "home") or table.includes(t.tags, "work"))',
    );
  });

  test("an or inside parentheses or a string isn't wrapped", () => {
    const m = example1();
    m.filters = [
      ff("done", "false"),
      {
        kind: "expr",
        expr: 'not (t.done or t.due == nil) and t.name ~= "a or b"',
      },
    ];
    expect(generateQuery(m, taskAttributes)).toContain(
      '\n    and not (t.done or t.due == nil) and t.name ~= "a or b"',
    );
  });

  test("text operators on a mixed attribute don't throw", async () => {
    const env = new LuaEnv(luaBuildStandardEnv());
    const index = new LuaTable();
    await index.set("objects", () =>
      jsToLuaValue([{ rating: 5 }, { rating: "loved it" }, { rating: 3 }]),
    );
    env.set("index", index);
    const attributes = inferAttributes(
      [{ rating: 5 }, { rating: "loved it" }],
      null,
      false,
    );
    const m: QueryModel = {
      ...emptyModel(sourceFor("book"), attributes),
      filters: [ff("rating", "contains", { values: ["lo"] })],
    };
    const expr = parseExpressionString(
      generateQuery(m, attributes, { wrap: false }),
    );
    const sf = LuaStackFrame.createWithGlobalEnv(env, expr.ctx);
    const rows = luaValueToJS(await evalExpression(expr, env, sf), sf);
    expect(rows).toHaveLength(1);
  });

  test("Lua keywords are quoted as attribute names and keys", () => {
    for (const name of [
      "end",
      "in",
      "function",
      "not",
      "nil",
      "select",
      "from",
      "where",
      "limit",
    ]) {
      expect(attributeAccess("e", name)).toBe(`e[${JSON.stringify(name)}]`);
      expect(tableKey(name)).toBe(`[${JSON.stringify(name)}]`);
    }
    const attributes = inferAttributes(
      [{ start: "2026-10-21", end: "2026-10-22", in: 1 }],
      null,
      false,
    );
    const text = generateQuery(
      emptyModel(sourceFor("event"), attributes),
      attributes,
    );
    expect(text).toContain('["end"] = e["end"]');
    expect(() => parseExpressionString(unwrap(text))).not.toThrow();
  });

  test("an aggregate sort follows its column when the header is renamed", () => {
    const m = grouped();
    m.sorts = [{ by: { kind: "column", id: "r" }, desc: true }];
    m.groupColumns = m.groupColumns.map((a) =>
      a.id === "r" ? { ...a, header: "N" } : a,
    );
    expect(generateQuery(m, bookAttributes)).toContain(
      "order by avg(b.rating) desc",
    );
  });

  test("a sort on a removed aggregate is left out", () => {
    const m = grouped();
    m.sorts = [{ by: { kind: "column", id: "r" }, desc: true }];
    m.groupColumns = m.groupColumns.filter((a) => a.id !== "r");
    expect(generateQuery(m, bookAttributes)).not.toMatch(/^\s*order by/m);
  });

  test("a key sort follows its key as keys are added and removed", () => {
    let m = grouped();
    m.sorts = [{ by: { kind: "groupKey", attribute: "rating" }, desc: false }];
    m = addGroupKey(m, "rating");
    expect(generateQuery(m, bookAttributes)).toContain("order by key[2]");
    m = removeGroupKey(m, "status");
    expect(generateQuery(m, bookAttributes)).toContain("order by key\n");
  });

  test("ordering by a second group key sorts by it", async () => {
    let m = addGroupKey(grouped(), "rating");
    m = {
      ...m,
      groupColumns: m.groupColumns.filter((a) => a.kind === "key"),
      sorts: [
        {
          by: { kind: "groupKey", attribute: "rating" },
          desc: true,
          nulls: "last",
        },
        { by: { kind: "groupKey", attribute: "status" }, desc: false },
      ],
    };
    const rows = await run(generateQuery(m, bookAttributes));
    const ratings = rows.map((r: any) => r.rating ?? null);
    expect(ratings.slice(0, 3)).toEqual([5, 4, 3]);
  });
});

describe("generated queries run", () => {
  test("example 1 returns the five earliest open tasks", async () => {
    const rows = await run(generateQuery(example1(), taskAttributes));
    expect(rows).toHaveLength(5);
    expect(rows[0].Task).toBe("Update team wiki");
    expect(rows[0].Page).toBe("[[Work/Team]]");
  });

  test("guarded operators skip objects without the attribute", async () => {
    const ops: AttributeFilter[] = [
      ff("due", "before", { values: ["2026-11-01"] }),
      ff("due", "after", { values: ["2026-10-01"] }),
      ff("due", "between", { values: ["2026-10-01", "2026-11-01"] }),
      ff("due", "beforetoday"),
      ff("due", "aftertoday"),
      ff("name", "contains", { values: ["re"] }),
      ff("name", "starts", { values: ["Re"] }),
    ];
    for (const f of ops) {
      const m = { ...example1(), filters: [f], limit: null };
      await expect(
        run(generateQuery(m, taskAttributes)),
        f.op,
      ).resolves.toBeDefined();
    }
  });

  test("a nested attribute reads as nil where its record is missing", async () => {
    const attributes = inferAttributes(NOTES, null, false);
    let m: QueryModel = {
      ...emptyModel(sourceFor("note"), attributes),
      filters: [ff("meta.prefix", "exists")],
      sorts: [
        { by: { kind: "attribute", attribute: "meta.prefix" }, desc: false },
      ],
    };
    const rows = await run(generateQuery(m, attributes));
    expect(rows.map((r: any) => r.name)).toEqual(["Decorated"]);
    // The default table shows every note, with or without the record
    m = emptyModel(sourceFor("note"), attributes);
    expect((await run(generateQuery(m, attributes))).length).toBe(2);
    m = addGroupKey(m, "meta.prefix");
    expect(await run(generateQuery(m, attributes))).toHaveLength(2);
  });

  test("grouped by status, ordered by key", async () => {
    const rows = await run(generateQuery(grouped(), bookAttributes));
    expect(rows.map((r: any) => r.Status)).toEqual([
      "finished",
      "reading",
      "want",
    ]);
    expect(rows[0].Books).toBe(4);
  });

  test("grouped results can be ordered by an aggregate", async () => {
    const m = grouped();
    m.groupColumns = m.groupColumns.slice(0, 2);
    m.sorts = [{ by: { kind: "column", id: "n" }, desc: true }];
    const text = generateQuery(m, bookAttributes);
    expect(text).toContain("order by count(b.title) desc");
    const rows = await run(text);
    expect(rows[0].Status).toBe("finished");
  });
});
