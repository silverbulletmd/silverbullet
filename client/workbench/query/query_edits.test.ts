import { describe, expect, test } from "vitest";
import { inferAttributes } from "./query_attributes.ts";
import {
  addGroupKey,
  changeColumnKind,
  changeGroupColumn,
  changeOperator,
  changeSelectMode,
  dropAttributeUses,
  droppedMessage,
  dropSystemAttributeUses,
  GROUP_KEY_CHOICE,
  isGrouped,
  newAttributeFilter,
  removeGroupColumn,
  removeGroupKey,
  setAttributeType,
} from "./query_edits.ts";
import { sourceFor } from "./query_from.ts";
import { emptyModel, type QueryModel } from "./query_model.ts";
import type { AttributeFilter } from "./query_ops.ts";

const attributes = inferAttributes(
  [
    {
      name: "Send report",
      done: false,
      due: "2026-10-21",
      status: "open",
      genre: "x",
    },
  ],
  null,
  false,
);

const filter = (attribute: string, op: string): AttributeFilter => ({
  kind: "attribute",
  attribute,
  op,
  values: ["2026-11-01"],
});

function example1(): QueryModel {
  return {
    ...emptyModel(sourceFor("task"), attributes),
    filters: [filter("done", "false"), filter("due", "before")],
    sorts: [{ by: { kind: "attribute", attribute: "due" }, desc: false }],
    select: {
      mode: "table",
      columns: [
        { id: "name", header: "Task", kind: "attribute", value: "name" },
        { id: "due", header: "Due date", kind: "attribute", value: "due" },
      ],
    },
  };
}

describe("group keys", () => {
  test("key columns are added in order, before groupColumns", () => {
    let m = addGroupKey(emptyModel(sourceFor("book"), attributes), "status");
    m = {
      ...m,
      groupColumns: [
        ...m.groupColumns,
        {
          id: "n",
          header: "Books",
          kind: "agg",
          agg: "count",
          attribute: "name",
          sorted: false,
        },
      ],
    };
    m = addGroupKey(m, "genre");
    expect(m.group).toEqual(["status", "genre"]);
    expect(
      m.groupColumns.map((a) => [
        a.kind === "key" ? "key" : a.agg,
        a.attribute,
      ]),
    ).toEqual([
      ["key", "status"],
      ["key", "genre"],
      ["count", "name"],
    ]);
    expect(isGrouped(m)).toBe(true);
  });

  test("adding a key twice does nothing", () => {
    const m = addGroupKey(
      addGroupKey(emptyModel(sourceFor("book"), attributes), "status"),
      "status",
    );
    expect(m.group).toEqual(["status"]);
    expect(m.groupColumns).toHaveLength(1);
  });

  test("removing the last key clears the group columns", () => {
    const m = removeGroupKey(
      addGroupKey(emptyModel(sourceFor("book"), attributes), "status"),
      "status",
    );
    expect(m.group).toEqual([]);
    expect(m.groupColumns).toEqual([]);
    expect(isGrouped(m)).toBe(false);
  });

  test("removing one of two keys removes only its column", () => {
    let m = addGroupKey(
      addGroupKey(emptyModel(sourceFor("book"), attributes), "status"),
      "genre",
    );
    m = removeGroupKey(m, "status");
    expect(m.groupColumns.map((a) => a.attribute)).toEqual(["genre"]);
  });
});

describe("dropAttributeUses", () => {
  test("drops filters, sorts and columns that use the attribute", () => {
    const { model, dropped } = dropAttributeUses(example1(), "due");
    expect(dropped).toEqual({ filters: 1, sorts: 1, columns: 1, groups: 0 });
    expect(model.filters).toHaveLength(1);
    expect(model.sorts).toHaveLength(0);
    expect(model.select).toEqual({
      mode: "table",
      columns: [
        { id: "name", header: "Task", kind: "attribute", value: "name" },
      ],
    });
    expect(droppedMessage("due", dropped)).toBe(
      "Removed 1 filter, 1 sort and 1 column that used due",
    );
  });

  test("drops group keys and groupColumns of the attribute", () => {
    let m = addGroupKey(emptyModel(sourceFor("book"), attributes), "status");
    m = {
      ...m,
      groupColumns: [
        ...m.groupColumns,
        {
          id: "n",
          header: "N",
          kind: "agg",
          agg: "count",
          attribute: "status",
          sorted: false,
        },
      ],
    };
    const { model, dropped } = dropAttributeUses(m, "status");
    expect(model.group).toEqual([]);
    expect(model.groupColumns).toEqual([]);
    expect(dropped.groups).toBe(1);
    expect(dropped.columns).toBe(1);
  });

  test("nothing dropped means no message", () => {
    const { dropped } = dropAttributeUses(example1(), "genre");
    expect(droppedMessage("genre", dropped)).toBe(null);
  });

  test("plural counts", () => {
    expect(
      droppedMessage("due", { filters: 2, sorts: 0, columns: 3, groups: 0 }),
    ).toBe("Removed 2 filters and 3 columns that used due");
  });
});

describe("group columns", () => {
  const grouped = () => {
    const m = addGroupKey(emptyModel(sourceFor("book"), attributes), "status");
    return {
      ...m,
      groupColumns: [
        ...m.groupColumns,
        {
          id: "n",
          header: "N",
          kind: "agg" as const,
          agg: "count",
          attribute: "name",
          sorted: false,
        },
      ],
      sorts: [{ by: { kind: "column" as const, id: "n" }, desc: true }],
    };
  };

  test("removing a column removes the sort on it", () => {
    const m = removeGroupColumn(grouped(), "n");
    expect(m.groupColumns.map((c) => c.kind)).toEqual(["key"]);
    expect(m.sorts).toEqual([]);
  });

  test("a column becomes a group key and back, keeping its id and header", () => {
    const m = grouped();
    const agg = m.groupColumns[1];
    const key = changeGroupColumn(m, agg, GROUP_KEY_CHOICE, "name");
    expect(key).toEqual({
      id: "n",
      header: "N",
      kind: "key",
      attribute: "status",
    });
    expect(changeGroupColumn(m, key, "max", "done")).toEqual({
      id: "n",
      header: "N",
      kind: "agg",
      agg: "max",
      attribute: "done",
      sorted: false,
    });
  });

  test("an aggregate named key is an aggregate, not a group key", () => {
    const m = grouped();
    const c = changeGroupColumn(m, m.groupColumns[1], "key", "name");
    expect(c.kind).toBe("agg");
  });
});

describe("select", () => {
  const templates = [
    { id: "templates.pageItem", name: "pageItem", types: ["page"] },
    { id: "templates.taskItem", name: "taskItem", types: ["task"] },
  ];

  test("list mode picks the template that fits the tag; table mode every attribute", () => {
    const m = changeSelectMode(
      emptyModel(sourceFor("task"), attributes),
      "list",
      attributes,
      templates,
    );
    expect(m.select).toEqual({
      mode: "list",
      list: { template: "templates.taskItem" },
    });
    // Another tag's objects get the first template there is
    expect(
      changeSelectMode(
        emptyModel(sourceFor("book"), attributes),
        "list",
        attributes,
        templates,
      ).select,
    ).toEqual({ mode: "list", list: { template: "templates.pageItem" } });
    // Without templates, a custom one to start from
    expect(
      changeSelectMode(
        emptyModel(sourceFor("book"), attributes),
        "list",
        attributes,
        [],
      ).select,
    ).toEqual({ mode: "list", list: { custom: "* [[${name}]]" } });
    const back = changeSelectMode(m, "table", attributes, templates);
    expect(back.select.mode === "table" && back.select.columns.length).toBe(
      attributes.length,
    );
  });

  test("a column switched to an expression starts from its attribute", () => {
    const c = {
      id: "1",
      header: "Due",
      kind: "attribute" as const,
      value: "due",
    };
    const expr = changeColumnKind(c, "expr", "t", "name");
    expect(expr).toEqual({ ...c, kind: "expr", value: "t.due" });
    expect(changeColumnKind(expr, "link", "t", "name").value).toBe("name");
  });
});

describe("filters", () => {
  test("a new filter on a one-of attribute starts on its first value", () => {
    const enumAttributes = inferAttributes(
      [{ s: "a" }, { s: "a" }, { s: "b" }, { s: "b" }],
      null,
      false,
    );
    const m = emptyModel(sourceFor("x"), enumAttributes);
    expect(newAttributeFilter(m, enumAttributes, "s")).toEqual({
      kind: "attribute",
      attribute: "s",
      op: "is",
      values: ["a"],
    });
    expect(changeOperator(m, enumAttributes, "s", "oneof").values).toEqual([]);
  });
});

describe("attribute types", () => {
  test("a new type drops the filters it has no operator for", () => {
    const m = {
      ...example1(),
      filters: [filter("due", "before"), filter("due", "exists")],
    };
    const due = attributes.find((f) => f.name === "due")!;
    const { model, dropped } = setAttributeType(m, due, "number");
    expect(model.overrides).toEqual({ due: "number" });
    expect(model.filters.map((f) => f.kind === "attribute" && f.op)).toEqual([
      "exists",
    ]);
    expect(dropped.filters).toBe(1);
    // Its own type clears the override
    expect(setAttributeType(model, due, due.type).model.overrides).toEqual({});
  });

  test("hiding system attributes drops every use of them", () => {
    const withRef = inferAttributes([{ name: "x", ref: "p@1" }], null, false);
    const m = {
      ...emptyModel(sourceFor("task"), withRef),
      filters: [filter("ref", "exists")],
      sorts: [
        { by: { kind: "attribute" as const, attribute: "ref" }, desc: false },
      ],
    };
    const { model, dropped } = dropSystemAttributeUses(m, withRef);
    expect(model.filters).toEqual([]);
    expect(dropped).toEqual({ filters: 1, sorts: 1, columns: 0, groups: 0 });
  });
});
