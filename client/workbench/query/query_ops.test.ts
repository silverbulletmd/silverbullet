import { describe, expect, test } from "vitest";
import { type FieldFilter, filterLua, operatorsFor } from "./query_ops.ts";

const f = (field: string, op: string, extra: Partial<FieldFilter> = {}) =>
  ({
    kind: "field",
    field,
    op,
    values: [],
    ...extra,
  }) as FieldFilter;

describe("filterLua", () => {
  test("date comparisons are guarded against missing values", () => {
    expect(
      filterLua(
        f("due", "before", { values: ["2026-11-01"] }),
        "t.due",
        "date",
      ),
    ).toBe('type(t.due) == "string" and t.due < "2026-11-01"');
  });

  test("after today uses os.date", () => {
    expect(filterLua(f("deadline", "aftertoday"), "t.deadline", "date")).toBe(
      'type(t.deadline) == "string" and t.deadline > os.date("%Y-%m-%d")',
    );
  });

  test("a guarded compound condition is parenthesized", () => {
    expect(
      filterLua(
        f("rating", "between", { values: ["1", "5"] }),
        "t.rating",
        "number",
      ),
    ).toBe('type(t.rating) == "number" and (t.rating >= 1 and t.rating <= 5)');
  });

  test("one of becomes an or in parentheses", () => {
    expect(
      filterLua(
        f("status", "oneof", { values: ["reading", "want"] }),
        "b.status",
        "enum",
      ),
    ).toBe('(b.status == "reading" or b.status == "want")');
    expect(
      filterLua(f("status", "oneof", { values: ["want"] }), "b.status", "enum"),
    ).toBe('b.status == "want"');
  });

  test("booleans need no value", () => {
    expect(filterLua(f("done", "false"), "t.done", "boolean")).toBe(
      "not t.done",
    );
    expect(filterLua(f("done", "true"), "t.done", "boolean")).toBe("t.done");
  });

  test("list contains uses table.includes, unguarded", () => {
    expect(
      filterLua(f("tags", "contains", { values: ["work"] }), "t.tags", "list"),
    ).toBe('table.includes(t.tags, "work")');
  });

  test("text contains is a plain find, guarded", () => {
    expect(
      filterLua(f("name", "contains", { values: ["re"] }), "t.name", "text"),
    ).toBe('type(t.name) == "string" and t.name:find("re", 1, true)');
  });

  test("page link is matches with and without brackets", () => {
    expect(
      filterLua(
        f("owner", "is", { values: ["People/Sam Ortiz"] }),
        "p.owner",
        "pagelink",
      ),
    ).toBe(
      '(p.owner == "[[People/Sam Ortiz]]" or p.owner == "People/Sam Ortiz")',
    );
  });

  test("date-time on compares the date part", () => {
    expect(
      filterLua(
        f("lastModified", "on", { values: ["2026-10-15"] }),
        "p.lastModified",
        "datetime",
      ),
    ).toBe(
      'type(p.lastModified) == "string" and p.lastModified:sub(1, 10) == "2026-10-15"',
    );
  });

  test("numbers are written as numbers", () => {
    expect(
      filterLua(f("year", "gt", { values: ["2000"] }), "b.year", "number"),
    ).toBe('type(b.year) == "number" and b.year > 2000');
  });

  test("is empty is parenthesized, so it can be combined with and", () => {
    expect(filterLua(f("note", "empty"), "t.note", "text")).toBe(
      '(t.note == nil or t.note == "")',
    );
    expect(filterLua(f("tags", "empty"), "t.tags", "list")).toBe(
      "(t.tags == nil or #t.tags == 0)",
    );
  });

  test("exists and doesn't exist work for any type", () => {
    expect(filterLua(f("due", "exists"), "t.due", "date")).toBe("t.due ~= nil");
    expect(filterLua(f("due", "missing"), "t.due", "date")).toBe(
      "t.due == nil",
    );
  });

  test("expressions pass through unchanged, even when invalid", () => {
    expect(
      filterLua(
        { kind: "expr", expr: 'p.name:startsWith("Work/")' },
        "",
        "text",
      ),
    ).toBe('p.name:startsWith("Work/")');
    expect(filterLua({ kind: "expr", expr: "p.name ==" }, "", "text")).toBe(
      "p.name ==",
    );
  });
});

describe("operatorsFor", () => {
  test("records only offer exists and doesn't exist", () => {
    expect(operatorsFor("record").map((o) => o.id)).toEqual([
      "exists",
      "missing",
    ]);
  });

  test("every type ends with exists and doesn't exist", () => {
    for (const t of ["text", "enum", "number", "date", "list"] as const) {
      expect(
        operatorsFor(t)
          .slice(-2)
          .map((o) => o.id),
      ).toEqual(["exists", "missing"]);
    }
  });

  test("labels match the spec", () => {
    expect(operatorsFor("date").map((o) => o.label)).toEqual([
      "before",
      "after",
      "on",
      "between",
      "before today",
      "after today",
      "exists",
      "doesn't exist",
    ]);
  });
});
