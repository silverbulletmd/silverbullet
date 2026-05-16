import { expect, test } from "vitest";
import {
  translateListRequest,
  serializeLuaValue,
  type Filter,
} from "./translate_query.ts";

test("serializeLuaValue: numbers, booleans, null, strings", () => {
  expect(serializeLuaValue("42")).toBe("42");
  expect(serializeLuaValue("-3.14")).toBe("-3.14");
  expect(serializeLuaValue("true")).toBe("true");
  expect(serializeLuaValue("false")).toBe("false");
  expect(serializeLuaValue("null")).toBe("nil");
  expect(serializeLuaValue("hello")).toBe('"hello"');
  expect(serializeLuaValue('a"b\nc')).toBe('"a\\"b\\nc"');
});

test("serializeLuaValue: explicit type prefix overrides inference", () => {
  expect(serializeLuaValue("num:42")).toBe("42");
  expect(serializeLuaValue("str:42")).toBe('"42"');
  expect(serializeLuaValue("bool:true")).toBe("true");
});

test("translateListRequest: equality filter", () => {
  const out = translateListRequest({
    tag: "task",
    filters: [{ field: "done", op: "eq", value: "false" }],
    order: [],
    limit: 100,
    offset: 0,
  });
  expect(out.equivalentLua).toBe(
    `from _it = index.tag("task") where _it.done == false limit 100`,
  );
});

test("translateListRequest: every operator emits expected source", () => {
  const cases: Array<[Filter["op"], string, string]> = [
    ["ne", "5", "_it.f ~= 5"],
    ["gt", "5", "_it.f > 5"],
    ["gte", "5", "_it.f >= 5"],
    ["lt", "5", "_it.f < 5"],
    ["lte", "5", "_it.f <= 5"],
    ["startsWith", "Hi", `string.sub(_it.f, 1, #"Hi") == "Hi"`],
    ["contains", "x", `string.find(_it.f, "x", 1, true) ~= nil`],
  ];
  for (const [op, raw, expectedClause] of cases) {
    const out = translateListRequest({
      tag: "x",
      filters: [{ field: "f", op, value: raw }],
      order: [],
      limit: 10,
      offset: 0,
    });
    expect(out.equivalentLua).toContain(expectedClause);
  }
});

test("translateListRequest: in operator expands to or-chain", () => {
  const out = translateListRequest({
    tag: "x",
    filters: [{ field: "status", op: "in", value: "a,b,c" }],
    order: [],
    limit: 10,
    offset: 0,
  });
  expect(out.equivalentLua).toContain(
    `(_it.status == "a") or (_it.status == "b") or (_it.status == "c")`,
  );
});

test("translateListRequest: multiple filters are AND-ed", () => {
  const out = translateListRequest({
    tag: "task",
    filters: [
      { field: "done", op: "eq", value: "false" },
      { field: "priority", op: "gte", value: "2" },
    ],
    order: [],
    limit: 50,
    offset: 0,
  });
  expect(out.equivalentLua).toContain(
    `where (_it.done == false) and (_it.priority >= 2)`,
  );
});

test("translateListRequest: ordering, offset, select", () => {
  const out = translateListRequest({
    tag: "page",
    filters: [],
    order: [
      { field: "lastModified", desc: true },
      { field: "name", desc: false },
    ],
    limit: 10,
    offset: 20,
    select: ["name", "lastModified"],
  });
  expect(out.equivalentLua).toContain(
    "order by _it.lastModified desc, _it.name",
  );
  expect(out.equivalentLua).toContain("limit 10, 20");
  expect(out.equivalentLua).toContain(
    "select { name = _it.name, lastModified = _it.lastModified }",
  );
});

test("translateListRequest: dotted field paths allowed", () => {
  const out = translateListRequest({
    tag: "page",
    filters: [{ field: "meta.author", op: "eq", value: "alice" }],
    order: [],
    limit: 10,
    offset: 0,
  });
  expect(out.equivalentLua).toContain(`_it.meta.author == "alice"`);
});

test("translateListRequest rejects bad field paths", () => {
  expect(() =>
    translateListRequest({
      tag: "x",
      filters: [{ field: "1bad", op: "eq", value: "v" }],
      order: [],
      limit: 10,
      offset: 0,
    }),
  ).toThrow(/bad_field/);

  expect(() =>
    translateListRequest({
      tag: "x",
      filters: [{ field: "a; drop", op: "eq", value: "v" }],
      order: [],
      limit: 10,
      offset: 0,
    }),
  ).toThrow(/bad_field/);
});

test("translateListRequest: empty in-list rejected", () => {
  expect(() =>
    translateListRequest({
      tag: "x",
      filters: [{ field: "f", op: "in", value: "" }],
      order: [],
      limit: 10,
      offset: 0,
    }),
  ).toThrow(/bad_query/);
});

test("translateListRequest: result also produces a LuaCollectionQuery", () => {
  const out = translateListRequest({
    tag: "task",
    filters: [{ field: "done", op: "eq", value: "false" }],
    order: [{ field: "priority", desc: true }],
    limit: 5,
    offset: 0,
  });
  expect(out.query.limit).toBe(5);
  expect(out.query.offset).toBe(0);
  expect(out.query.where).toBeDefined();
  expect(out.query.orderBy).toHaveLength(1);
  expect(out.query.objectVariable).toBe("_it");
});
