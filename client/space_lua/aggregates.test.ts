import { parseExpressionString } from "./parse.ts";
import { evalExpression } from "./eval.ts";
import {
  type AggregateSpec,
  executeAggregate,
  getAggregateSpec,
} from "./aggregates.ts";
import {
  applyQuery,
  evalExpressionWithAggregates,
} from "./query_collection.ts";
import {
  LuaBuiltinFunction,
  LuaEnv,
  LuaStackFrame,
  LuaTable,
  luaValueToJS,
} from "./runtime.ts";
import { expect, test } from "vitest";

function luaArray(items: Record<string, any>[]): LuaTable {
  const t = new LuaTable();
  for (let i = 0; i < items.length; i++) {
    t.rawSetArrayIndex(i + 1, new LuaTable(items[i]));
  }
  return t;
}

function installFakeConfig(
  specs: Record<string, AggregateSpec> = {},
): () => void {
  const configStore: Record<string, any> = {};
  for (const [name, spec] of Object.entries(specs)) {
    configStore[`aggregates.${name}`] = spec;
  }
  const prev = (globalThis as any).client;
  (globalThis as any).client = {
    config: {
      get(key: string, fallback: any) {
        return configStore[key] ?? fallback;
      },
    },
  };
  return () => {
    (globalThis as any).client = prev;
  };
}

function requireSpec(name: string): AggregateSpec {
  const cleanup = installFakeConfig();
  const spec = getAggregateSpec(name);
  cleanup();
  if (!spec) throw new Error(`builtin aggregate "${name}" not found`);
  return spec;
}

const sumSpec = requireSpec("sum");
const countSpec = requireSpec("count");
const minSpec = requireSpec("min");
const maxSpec = requireSpec("max");
const avgSpec = requireSpec("avg");
const arrayAggSpec = requireSpec("array_agg");

const sf = LuaStackFrame.lostFrame;

// Unit tests per builtin

test("aggregate: sum", async () => {
  const result = await executeAggregate(
    sumSpec,
    luaArray([{ v: 10 }, { v: 20 }, { v: 30 }]),
    parseExpressionString("_.v"),
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
  );
  expect(result).toBe(60);
});

test("aggregate: sum with nils", async () => {
  const result = await executeAggregate(
    sumSpec,
    luaArray([{ v: 5 }, { x: 1 }, { v: 15 }]),
    parseExpressionString("_.v"),
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
  );
  expect(result).toBe(20);
});

test("aggregate: count with expression", async () => {
  const result = await executeAggregate(
    countSpec,
    luaArray([{ v: 1 }, { v: 2 }, { v: 3 }]),
    parseExpressionString("_.v"),
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
  );
  expect(result).toBe(3);
});

test("aggregate: count with no argument (count(*))", async () => {
  const result = await executeAggregate(
    countSpec,
    luaArray([{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }]),
    null,
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
  );
  expect(result).toBe(4);
});

test("aggregate: min", async () => {
  const result = await executeAggregate(
    minSpec,
    luaArray([{ v: 30 }, { v: 10 }, { v: 20 }]),
    parseExpressionString("_.v"),
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
  );
  expect(result).toBe(10);
});

test("aggregate: max", async () => {
  const result = await executeAggregate(
    maxSpec,
    luaArray([{ v: 30 }, { v: 10 }, { v: 20 }]),
    parseExpressionString("_.v"),
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
  );
  expect(result).toBe(30);
});

test("aggregate: avg", async () => {
  const result = await executeAggregate(
    avgSpec,
    luaArray([{ v: 10 }, { v: 20 }, { v: 30 }]),
    parseExpressionString("_.v"),
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
  );
  expect(result).toBe(20);
});

test("aggregate: avg empty group", async () => {
  const result = await executeAggregate(
    avgSpec,
    new LuaTable(),
    parseExpressionString("_.v"),
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
  );
  expect(result).toBeNull();
});

test("aggregate: min/max on empty group", async () => {
  const items = new LuaTable();
  const env = new LuaEnv();
  const expr = parseExpressionString("_.v");
  expect(
    await executeAggregate(minSpec, items, expr, undefined, env, sf, evalExpression),
  ).toBeNull();
  expect(
    await executeAggregate(maxSpec, items, expr, undefined, env, sf, evalExpression),
  ).toBeNull();
});

test("aggregate: array_agg", async () => {
  const result = await executeAggregate(
    arrayAggSpec,
    luaArray([{ v: "a" }, { v: "b" }, { v: "c" }]),
    parseExpressionString("_.v"),
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
  );
  expect(result).toBeInstanceOf(LuaTable);
  expect((result as LuaTable).rawGet(1)).toBe("a");
  expect((result as LuaTable).rawGet(2)).toBe("b");
  expect((result as LuaTable).rawGet(3)).toBe("c");
});

test("aggregate: sum with objectVariable", async () => {
  const result = await executeAggregate(
    sumSpec,
    luaArray([{ v: 3 }, { v: 7 }]),
    parseExpressionString("p.v"),
    "p",
    new LuaEnv(),
    sf,
    evalExpression,
  );
  expect(result).toBe(10);
});

test("aggregate: user-defined overrides builtin", async () => {
  const customSum: AggregateSpec = {
    name: "sum",
    initialize: new LuaBuiltinFunction((_sf) => 100),
    iterate: new LuaBuiltinFunction((_sf, state: any, value: any) => {
      if (value === null || value === undefined) return state;
      return state + value;
    }),
  };
  const cleanup = installFakeConfig({ sum: customSum });
  try {
    const spec = getAggregateSpec("sum")!;
    const result = await executeAggregate(
      spec,
      luaArray([{ v: 1 }, { v: 2 }]),
      parseExpressionString("_.v"),
      undefined,
      new LuaEnv(),
      sf,
      evalExpression,
    );
    expect(result).toBe(103);
  } finally {
    cleanup();
  }
});

test("aggregate: builtin available without config", () => {
  const cleanup = installFakeConfig();
  try {
    const spec = getAggregateSpec("sum");
    expect(spec).not.toBeNull();
    expect(spec!.name).toBe("sum");

    const spec2 = getAggregateSpec("nonexistent");
    expect(spec2).toBeNull();
  } finally {
    cleanup();
  }
});

test("evalExpressionWithAggregates: sum in table constructor", async () => {
  const cleanup = installFakeConfig();
  try {
    const groupItems = luaArray([{ age: 10 }, { age: 20 }, { age: 30 }]);
    const env = new LuaEnv();
    const expr = parseExpressionString("{ total = sum(_.age) }");
    const result = await evalExpressionWithAggregates(
      expr,
      env,
      sf,
      groupItems,
      undefined,
      env,
    );
    expect(result).toBeInstanceOf(LuaTable);
    expect((result as LuaTable).rawGet("total")).toBe(60);
  } finally {
    cleanup();
  }
});

test("evalExpressionWithAggregates: count() with no args", async () => {
  const cleanup = installFakeConfig();
  try {
    const groupItems = luaArray([{ x: 1 }, { x: 2 }, { x: 3 }]);
    const env = new LuaEnv();
    const expr = parseExpressionString("count()");
    const result = await evalExpressionWithAggregates(
      expr,
      env,
      sf,
      groupItems,
      undefined,
      env,
    );
    expect(result).toBe(3);
  } finally {
    cleanup();
  }
});

test("evalExpressionWithAggregates: non-aggregate falls through", async () => {
  const cleanup = installFakeConfig();
  try {
    const env = new LuaEnv();
    env.setLocal("key", "hello");
    const expr = parseExpressionString("key");
    const result = await evalExpressionWithAggregates(
      expr,
      env,
      sf,
      new LuaTable(),
      undefined,
      env,
    );
    expect(result).toBe("hello");
  } finally {
    cleanup();
  }
});

test("evalExpressionWithAggregates: multiple aggregates in table", async () => {
  const cleanup = installFakeConfig();
  try {
    const groupItems = luaArray([{ v: 5 }, { v: 15 }, { v: 10 }]);
    const env = new LuaEnv();
    env.setLocal("key", "grp1");
    const expr = parseExpressionString(
      "{ k = key, total = sum(_.v), n = count(_.v), smallest = min(_.v) }",
    );
    const result = await evalExpressionWithAggregates(
      expr,
      env,
      sf,
      groupItems,
      undefined,
      env,
    );
    const tbl = result as LuaTable;
    expect(tbl.rawGet("k")).toBe("grp1");
    expect(tbl.rawGet("total")).toBe(30);
    expect(tbl.rawGet("n")).toBe(3);
    expect(tbl.rawGet("smallest")).toBe(5);
  } finally {
    cleanup();
  }
});

test("evalExpressionWithAggregates: avg with finish step", async () => {
  const cleanup = installFakeConfig();
  try {
    const groupItems = luaArray([{ v: 10 }, { v: 30 }]);
    const env = new LuaEnv();
    const expr = parseExpressionString("avg(_.v)");
    const result = await evalExpressionWithAggregates(
      expr,
      env,
      sf,
      groupItems,
      undefined,
      env,
    );
    expect(result).toBe(20);
  } finally {
    cleanup();
  }
});

test("evalExpressionWithAggregates: binary comparison (count > N)", async () => {
  const cleanup = installFakeConfig();
  try {
    const groupItems = luaArray([{ v: 1 }, { v: 2 }, { v: 3 }]);
    const env = new LuaEnv();
    const result = await evalExpressionWithAggregates(
      parseExpressionString("count(_.v) > 2"),
      env,
      sf,
      groupItems,
      undefined,
      env,
    );
    expect(result).toBe(true);
  } finally {
    cleanup();
  }
});

test("evalExpressionWithAggregates: binary arithmetic (sum + sum)", async () => {
  const cleanup = installFakeConfig();
  try {
    const groupItems = luaArray([{ a: 10, b: 5 }, { a: 20, b: 15 }]);
    const env = new LuaEnv();
    const result = await evalExpressionWithAggregates(
      parseExpressionString("sum(_.a) + sum(_.b)"),
      env,
      sf,
      groupItems,
      undefined,
      env,
    );
    expect(result).toBe(50);
  } finally {
    cleanup();
  }
});

test("evalExpressionWithAggregates: unary minus on aggregate", async () => {
  const cleanup = installFakeConfig();
  try {
    const groupItems = luaArray([{ v: 10 }, { v: 20 }]);
    const env = new LuaEnv();
    const result = await evalExpressionWithAggregates(
      parseExpressionString("-sum(_.v)"),
      env,
      sf,
      groupItems,
      undefined,
      env,
    );
    expect(result).toBe(-30);
  } finally {
    cleanup();
  }
});

test("evalExpressionWithAggregates: parenthesized aggregate", async () => {
  const cleanup = installFakeConfig();
  try {
    const groupItems = luaArray([{ v: 7 }, { v: 3 }]);
    const env = new LuaEnv();
    const result = await evalExpressionWithAggregates(
      parseExpressionString("(sum(_.v))"),
      env,
      sf,
      groupItems,
      undefined,
      env,
    );
    expect(result).toBe(10);
  } finally {
    cleanup();
  }
});

test("evalExpressionWithAggregates: and short-circuit", async () => {
  const cleanup = installFakeConfig();
  try {
    const groupItems = luaArray([{ v: 1 }]);
    const env = new LuaEnv();
    expect(
      await evalExpressionWithAggregates(
        parseExpressionString("count(_.v) and 42"),
        env,
        sf,
        groupItems,
        undefined,
        env,
      ),
    ).toBe(42);
    expect(
      await evalExpressionWithAggregates(
        parseExpressionString("false and count(_.v)"),
        env,
        sf,
        groupItems,
        undefined,
        env,
      ),
    ).toBe(false);
  } finally {
    cleanup();
  }
});

test("evalExpressionWithAggregates: or short-circuit", async () => {
  const cleanup = installFakeConfig();
  try {
    const groupItems = luaArray([{ v: 1 }]);
    const env = new LuaEnv();
    expect(
      await evalExpressionWithAggregates(
        parseExpressionString("count(_.v) or 99"),
        env,
        sf,
        groupItems,
        undefined,
        env,
      ),
    ).toBe(1);
    expect(
      await evalExpressionWithAggregates(
        parseExpressionString("nil or count(_.v)"),
        env,
        sf,
        groupItems,
        undefined,
        env,
      ),
    ).toBe(1);
  } finally {
    cleanup();
  }
});

test("evalExpressionWithAggregates: not aggregate", async () => {
  const cleanup = installFakeConfig();
  try {
    const groupItems = luaArray([{ v: 1 }]);
    const env = new LuaEnv();
    expect(
      await evalExpressionWithAggregates(
        parseExpressionString("not count(_.v)"),
        env,
        sf,
        groupItems,
        undefined,
        env,
      ),
    ).toBe(false);
  } finally {
    cleanup();
  }
});

test("applyQuery: group by + select with aggregates", async () => {
  const cleanup = installFakeConfig();
  try {
    const data = [
      new LuaTable({ dept: "eng", salary: 100 }),
      new LuaTable({ dept: "eng", salary: 200 }),
      new LuaTable({ dept: "sales", salary: 150 }),
      new LuaTable({ dept: "sales", salary: 50 }),
      new LuaTable({ dept: "sales", salary: 100 }),
    ];
    const results = await applyQuery(
      data,
      {
        objectVariable: "p",
        groupBy: [parseExpressionString("p.dept")],
        select: parseExpressionString(
          "{ dept = key, total = sum(p.salary), n = count(p.salary) }",
        ),
      },
      new LuaEnv(),
      sf,
      {},
    );
    expect(results.length).toBe(2);
    const eng = results[0] as LuaTable;
    const sales = results[1] as LuaTable;
    expect(eng.rawGet("dept")).toBe("eng");
    expect(eng.rawGet("total")).toBe(300);
    expect(eng.rawGet("n")).toBe(2);
    expect(sales.rawGet("dept")).toBe("sales");
    expect(sales.rawGet("total")).toBe(300);
    expect(sales.rawGet("n")).toBe(3);
  } finally {
    cleanup();
  }
});

test("applyQuery: group by + having with aggregate", async () => {
  const cleanup = installFakeConfig();
  try {
    const data = [
      new LuaTable({ dept: "eng", name: "a" }),
      new LuaTable({ dept: "eng", name: "b" }),
      new LuaTable({ dept: "sales", name: "c" }),
    ];
    const results = await applyQuery(
      data,
      {
        objectVariable: "p",
        groupBy: [parseExpressionString("p.dept")],
        having: parseExpressionString("count(p.name) > 1"),
      },
      new LuaEnv(),
      sf,
      {},
    );
    expect(results.length).toBe(1);
    expect((results[0] as LuaTable).rawGet("key")).toBe("eng");
  } finally {
    cleanup();
  }
});

test("applyQuery: group by without aggregates still works", async () => {
  const cleanup = installFakeConfig();
  try {
    const data = [
      new LuaTable({ dept: "eng", name: "a" }),
      new LuaTable({ dept: "eng", name: "b" }),
      new LuaTable({ dept: "sales", name: "c" }),
    ];
    const results = await applyQuery(
      data,
      {
        objectVariable: "p",
        groupBy: [parseExpressionString("p.dept")],
        select: parseExpressionString("key"),
      },
      new LuaEnv(),
      sf,
      {},
    );
    expect(results.length).toBe(2);
    expect(results[0]).toBe("eng");
    expect(results[1]).toBe("sales");
  } finally {
    cleanup();
  }
});

test("applyQuery: having with compound expression", async () => {
  const cleanup = installFakeConfig();
  try {
    const data = [
      new LuaTable({ dept: "eng", salary: 100 }),
      new LuaTable({ dept: "eng", salary: 200 }),
      new LuaTable({ dept: "sales", salary: 50 }),
    ];
    const results = await applyQuery(
      data,
      {
        objectVariable: "p",
        groupBy: [parseExpressionString("p.dept")],
        having: parseExpressionString("sum(p.salary) > 100"),
        select: parseExpressionString("{ dept = key, total = sum(p.salary) }"),
      },
      new LuaEnv(),
      sf,
      {},
    );
    expect(results.length).toBe(1);
    expect((results[0] as LuaTable).rawGet("dept")).toBe("eng");
    expect((results[0] as LuaTable).rawGet("total")).toBe(300);
  } finally {
    cleanup();
  }
});

test("applyQuery: implicit _ with group by + multiple aggregates", async () => {
  const cleanup = installFakeConfig();
  try {
    const data = [
      new LuaTable({ category: "fruit", price: 3 }),
      new LuaTable({ category: "fruit", price: 5 }),
      new LuaTable({ category: "veg", price: 2 }),
      new LuaTable({ category: "veg", price: 7 }),
      new LuaTable({ category: "veg", price: 1 }),
    ];
    const results = await applyQuery(
      data,
      {
        groupBy: [parseExpressionString("_.category")],
        select: parseExpressionString(
          "{ cat = key, total = sum(_.price), best = max(_.price) }",
        ),
      },
      new LuaEnv(),
      sf,
      {},
    );
    expect(results.length).toBe(2);
    const fruit = results[0] as LuaTable;
    expect(fruit.rawGet("cat")).toBe("fruit");
    expect(fruit.rawGet("total")).toBe(8);
    expect(fruit.rawGet("best")).toBe(5);
    const veg = results[1] as LuaTable;
    expect(veg.rawGet("cat")).toBe("veg");
    expect(veg.rawGet("total")).toBe(10);
    expect(veg.rawGet("best")).toBe(7);
  } finally {
    cleanup();
  }
});

test("applyQuery: group by + having + order by + limit", async () => {
  const cleanup = installFakeConfig();
  try {
    const data = [
      new LuaTable({ tag: "a", page: "p1" }),
      new LuaTable({ tag: "a", page: "p2" }),
      new LuaTable({ tag: "a", page: "p3" }),
      new LuaTable({ tag: "b", page: "p1" }),
      new LuaTable({ tag: "c", page: "p1" }),
      new LuaTable({ tag: "c", page: "p2" }),
    ];
    const results = await applyQuery(
      data,
      {
        objectVariable: "t",
        groupBy: [parseExpressionString("t.tag")],
        having: parseExpressionString("count(t.page) > 1"),
        orderBy: [{ expr: parseExpressionString("key"), desc: false }],
        select: parseExpressionString("key"),
        limit: 1,
      },
      new LuaEnv(),
      sf,
      {},
    );
    expect(results.length).toBe(1);
    expect(results[0]).toBe("a");
  } finally {
    cleanup();
  }
});

test("applyQuery: select with aggregate division (float result)", async () => {
  const cleanup = installFakeConfig();
  try {
    const data = [
      new LuaTable({ dept: "eng", salary: 100 }),
      new LuaTable({ dept: "eng", salary: 200 }),
    ];
    const results = await applyQuery(
      data,
      {
        objectVariable: "p",
        groupBy: [parseExpressionString("p.dept")],
        select: parseExpressionString(
          "{ dept = key, avg_salary = sum(p.salary) / count(p.salary) }",
        ),
      },
      new LuaEnv(),
      sf,
      {},
    );
    expect(results.length).toBe(1);
    const row = results[0] as LuaTable;
    expect(row.rawGet("dept")).toBe("eng");
    expect(luaValueToJS(row.rawGet("avg_salary"), sf)).toBe(150);
  } finally {
    cleanup();
  }
});

test("aggregate: custom concat with finish", async () => {
  const concatSpec: AggregateSpec = {
    name: "concat",
    initialize: new LuaBuiltinFunction((_sf) =>
      new LuaTable({ first: true, s: "" })
    ),
    iterate: new LuaBuiltinFunction((_sf, state: any, value: any) => {
      if (value === null || value === undefined) return state;
      if (state.rawGet("first")) {
        state.rawSet("s", String(value));
        state.rawSet("first", false);
      } else {
        state.rawSet("s", state.rawGet("s") + ", " + String(value));
      }
      return state;
    }),
    finish: new LuaBuiltinFunction((_sf, state: any) => state.rawGet("s")),
  };
  const result = await executeAggregate(
    concatSpec,
    luaArray([{ v: "a" }, { v: "b" }, { v: "c" }]),
    parseExpressionString("_.v"),
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
  );
  expect(result).toBe("a, b, c");
});
