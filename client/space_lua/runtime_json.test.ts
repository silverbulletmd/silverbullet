import { expect, test } from "vitest";
import { evalStatement } from "./eval.ts";
import { parseBlock } from "./parse.ts";
import { ArrayQueryCollection } from "./query_collection.ts";
import {
  LuaBuiltinFunction,
  LuaEnv,
  LuaFunction,
  LuaStackFrame,
  LuaTable,
} from "./runtime.ts";
import { maxCollectionRows, toRuntimeJSON } from "./runtime_json.ts";
import { SLIQ_NULL } from "./sliq_null.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";
import { makeLuaFloat } from "./numeric.ts";

const books = [
  { name: "Books/Alpha", author: "A. Writer", rating: 4, status: "read" },
  { name: "Books/Beta", author: "B. Writer", status: "reading" },
];

async function runLua(code: string): Promise<any> {
  const env = new LuaEnv(luaBuildStandardEnv());
  env.set("books", new ArrayQueryCollection(books));
  const block = parseBlock(code);
  const sf = new LuaStackFrame(env, block.ctx);
  const result: any = await evalStatement(block, env, sf);
  return result?.ctrl === "return" ? result.values[0] : result;
}

// The contract CDP `returnByValue` (and postMessage) needs.
function expectPlainJSON(out: unknown) {
  expect(() => structuredClone(out)).not.toThrow();
  expect(JSON.parse(JSON.stringify(out))).toEqual(out);
}

test("select rows that lack a field get null for it, keeping the key", async () => {
  const rows = await runLua(
    `return query[[from p = books select {name=p.name, rating=p.rating}]]`,
  );
  // The engine marks the missing column with the sentinel this converts.
  expect(rows.rawGet(2).rawGet("rating")).toBe(SLIQ_NULL);
  const out = await toRuntimeJSON(rows);
  expect(out).toEqual([
    { name: "Books/Alpha", rating: 4 },
    { name: "Books/Beta", rating: null },
  ]);
  expect(Object.keys((out as any[])[1])).toEqual(["name", "rating"]);
  expectPlainJSON(out);
});

test("multi-column select and table.select with a missing field", async () => {
  const multi = await toRuntimeJSON(
    await runLua(`return query[[from p = books select p.name, p.rating]]`),
  );
  expectPlainJSON(multi);
  expect((multi as any[])[1]).toEqual({ name: "Books/Beta", rating: null });

  const picked = await toRuntimeJSON(
    await runLua(
      `return query[[from p = books select table.select(p, "name", "rating")]]`,
    ),
  );
  expectPlainJSON(picked);
  expect((picked as any[])[1]).toEqual({ name: "Books/Beta", rating: null });
});

test("group by with an aggregate that is nil for one group", async () => {
  const out = await toRuntimeJSON(
    await runLua(
      `return query[[from p = books group by p.status order by key select {k=key, r=max(p.rating)}]]`,
    ),
  );
  expectPlainJSON(out);
  expect(out).toEqual([
    { k: "read", r: 4 },
    { k: "reading", r: null },
  ]);
});

test("scalars, nil and the SQL null sentinel", async () => {
  expect(await toRuntimeJSON(SLIQ_NULL)).toBeNull();
  expect(await toRuntimeJSON(null)).toBeNull();
  expect(await toRuntimeJSON(undefined)).toBeNull();
  expect(await toRuntimeJSON("hi")).toBe("hi");
  expect(await toRuntimeJSON(true)).toBe(true);
  expect(await toRuntimeJSON(42)).toBe(42);
  expect(await toRuntimeJSON(makeLuaFloat(2))).toBe(2);
  expect(await toRuntimeJSON(-0)).toBe(0);
  expect(Object.is(await toRuntimeJSON(-0), 0)).toBe(true);
});

test("non-finite numbers and BigInt become explicit values", async () => {
  expect(await toRuntimeJSON(Number.NaN)).toBe("NaN");
  expect(await toRuntimeJSON(Number.POSITIVE_INFINITY)).toBe("Infinity");
  expect(await toRuntimeJSON(Number.NEGATIVE_INFINITY)).toBe("-Infinity");
  expect(await toRuntimeJSON(10n)).toBe(10);
  expect(await toRuntimeJSON(2n ** 64n)).toBe("18446744073709551616");
  const nested = await toRuntimeJSON({ b: 10n, i: Number.POSITIVE_INFINITY });
  expect(nested).toEqual({ b: 10, i: "Infinity" });
  expectPlainJSON(nested);
});

test("Lua tables become arrays or objects", async () => {
  expect(await toRuntimeJSON(new LuaTable([1, 2, 3]))).toEqual([1, 2, 3]);
  expect(await toRuntimeJSON(new LuaTable({ a: 1 }))).toEqual({ a: 1 });
  expect(await toRuntimeJSON(new LuaTable())).toEqual({});
  const nested = new LuaTable([new LuaTable({ x: new LuaTable([1]) })]);
  expect(await toRuntimeJSON(nested)).toEqual([{ x: [1] }]);
  // A hole in the array part is a nil, so it stays positional as null.
  expect(await toRuntimeJSON(new LuaTable([1, SLIQ_NULL, 3]))).toEqual([
    1,
    null,
    3,
  ]);

  // Mixed tables keep both parts instead of dropping the string keys.
  const mixed = await runLua(`return {10, 20, label="x"}`);
  const out = await toRuntimeJSON(mixed);
  expect(out).toEqual({ "1": 10, "2": 20, label: "x" });
  expectPlainJSON(out);
});

test("functions and symbols become markers", async () => {
  const fn = await runLua(`return function() end`);
  expect(fn).toBeInstanceOf(LuaFunction);
  expect(await toRuntimeJSON(fn)).toBe("<function>");
  expect(await toRuntimeJSON(new LuaBuiltinFunction(() => null as any))).toBe(
    "<function>",
  );
  expect(await toRuntimeJSON(() => 1)).toBe("<function>");
  expect(await toRuntimeJSON(Symbol("x"))).toBe("<symbol>");
  const out = await toRuntimeJSON(
    new LuaTable({ f: () => 1, s: Symbol.iterator }),
  );
  expect(out).toEqual({ f: "<function>", s: "<symbol>" });
  expectPlainJSON(out);
});

test("Dates, Maps, Sets and bytes", async () => {
  expect(await toRuntimeJSON(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
  expect(await toRuntimeJSON(new Date(Number.NaN))).toBeNull();
  expect(
    await toRuntimeJSON(
      new Map<any, any>([
        ["a", 1],
        [2, new Date(0)],
      ]),
    ),
  ).toEqual({ a: 1, "2": "1970-01-01T00:00:00.000Z" });
  expect(await toRuntimeJSON(new Set([1, "x"]))).toEqual([1, "x"]);
  expect(await toRuntimeJSON(new Uint8Array([1, 2, 3]))).toBe(
    "<binary: 3 bytes>",
  );
});

test("cycles become a marker; shared non-cyclic values do not", async () => {
  const t = await runLua(`local t = {name="loop"}; t.self = t; return t`);
  const out = await toRuntimeJSON(t);
  expect(out).toEqual({ name: "loop", self: "<cycle>" });
  expectPlainJSON(out);

  const shared = { v: 1 };
  expect(await toRuntimeJSON({ a: shared, b: shared })).toEqual({
    a: { v: 1 },
    b: { v: 1 },
  });

  const arr: any[] = [1];
  arr.push(arr);
  expect(await toRuntimeJSON(arr)).toEqual([1, "<cycle>"]);
});

test("deep nesting is capped", async () => {
  let deep: any = { leaf: true };
  for (let i = 0; i < 1000; i++) deep = { d: deep };
  const out = await toRuntimeJSON(deep);
  expect(JSON.stringify(out)).toContain('"<max depth>"');
  expectPlainJSON(out);
});

test("nested promises are awaited", async () => {
  const out = await toRuntimeJSON(
    Promise.resolve({
      a: Promise.resolve(new LuaTable({ x: Promise.resolve(SLIQ_NULL) })),
      b: [Promise.resolve(1)],
    }),
  );
  expect(out).toEqual({ a: { x: null }, b: [1] });
});

test("plain object fields that are undefined keep their key as null", async () => {
  const out = await toRuntimeJSON({ u: undefined, n: 1 });
  expect(out).toEqual({ u: null, n: 1 });
  expect(Object.keys(out as object)).toEqual(["u", "n"]);
});

test("every output survives structuredClone and a JSON round-trip", async () => {
  const cyclic: any = { name: "c" };
  cyclic.me = cyclic;
  const samples: unknown[] = [
    SLIQ_NULL,
    Number.NaN,
    -0,
    2n ** 70n,
    new Date(5),
    new Map([[{}, 1]]),
    new Set([Symbol("s")]),
    new Uint8Array(4),
    cyclic,
    new LuaTable([SLIQ_NULL, new LuaTable({ f: () => 1 })]),
    [undefined, null, Number.NEGATIVE_INFINITY],
    new ArrayQueryCollection([]),
    new Error("boom"),
    new (class Widget {
      x = 1;
    })(),
    Promise.resolve(Symbol.for("silverbullet.sqlNull")),
  ];
  for (const sample of samples) {
    expectPlainJSON(await toRuntimeJSON(sample));
  }
});

test("query collections are materialized into their rows", async () => {
  const out = await toRuntimeJSON(new ArrayQueryCollection(books));
  expect(out).toEqual([
    { name: "Books/Alpha", author: "A. Writer", rating: 4, status: "read" },
    { name: "Books/Beta", author: "B. Writer", status: "reading" },
  ]);
  expectPlainJSON(out);
  // Straight from Lua, as `sb eval 'index.pages("book")'` returns it.
  expect(await toRuntimeJSON(await runLua("return books"))).toEqual(out);
});

test("collections query with no clauses in the given env and frame", async () => {
  const env = new LuaEnv();
  const sf = LuaStackFrame.createWithGlobalEnv(env);
  const calls: any[] = [];
  // Shaped like DataStoreQueryCollection: rows come back as Lua tables.
  const store = {
    prefix: ["tag", "page"],
    query(query: any, qEnv: LuaEnv, qSf: LuaStackFrame) {
      calls.push({ query, qEnv, qSf });
      return Promise.resolve([
        new LuaTable({ name: "Page A", tags: new LuaTable(["book"]) }),
      ]);
    },
  };
  const out = await toRuntimeJSON(store, { env, sf });
  expect(out).toEqual([{ name: "Page A", tags: ["book"] }]);
  expect(calls).toEqual([{ query: {}, qEnv: env, qSf: sf }]);
});

test("collections nested in tables are materialized too", async () => {
  const out = await toRuntimeJSON(
    await runLua(`return {count = 2, pages = books, more = {books}}`),
  );
  const rows = [
    { name: "Books/Alpha", author: "A. Writer", rating: 4, status: "read" },
    { name: "Books/Beta", author: "B. Writer", status: "reading" },
  ];
  expect(out).toEqual({ count: 2, pages: rows, more: [rows] });
  expectPlainJSON(out);
});

test("materialized collections are capped with a truncation entry", async () => {
  expect(maxCollectionRows).toBe(1000);
  const rows = Array.from({ length: 1003 }, (_, i) => i);
  const out = (await toRuntimeJSON(new ArrayQueryCollection(rows))) as any[];
  expect(out).toHaveLength(1001);
  expect(out.slice(0, 1000)).toEqual(rows.slice(0, 1000));
  expect(out[1000]).toBe(
    "<truncated: 3 more rows; use sb query with where/limit>",
  );

  expect(
    await toRuntimeJSON(new ArrayQueryCollection([1, 2, 3]), {
      maxCollectionRows: 2,
    }),
  ).toEqual([1, 2, "<truncated: 1 more rows; use sb query with where/limit>"]);
  // Exactly at the cap: nothing is cut, so no entry.
  expect(
    await toRuntimeJSON(new ArrayQueryCollection([1, 2]), {
      maxCollectionRows: 2,
    }),
  ).toEqual([1, 2]);
});
