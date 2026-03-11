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
  jsToLuaValue,
  LuaBuiltinFunction,
  LuaEnv,
  LuaStackFrame,
  LuaTable,
  luaValueToJS,
} from "./runtime.ts";
import type { LuaOrderBy } from "./ast.ts";
import { expect, test } from "vitest";
import { Config } from "../config.ts";

function makeConfig(specs: Record<string, AggregateSpec> = {}): Config {
  const config = new Config();
  for (const [name, spec] of Object.entries(specs)) {
    config.set(`aggregates.${name}`, spec);
  }
  return config;
}

function requireSpec(name: string): AggregateSpec {
  const spec = getAggregateSpec(name);
  if (!spec) throw new Error(`builtin aggregate "${name}" not found`);
  return spec;
}

function makeOrderBy(
  exprStr: string,
  direction: "asc" | "desc" = "asc",
  nulls?: "first" | "last",
): LuaOrderBy {
  const ob: LuaOrderBy = {
    type: "Order",
    expression: parseExpressionString(exprStr),
    direction,
    ctx: {},
  };
  if (nulls) ob.nulls = nulls;
  return ob;
}

const sumSpec = requireSpec("sum");
const countSpec = requireSpec("count");
const minSpec = requireSpec("min");
const maxSpec = requireSpec("max");
const avgSpec = requireSpec("avg");
const arrayAggSpec = requireSpec("array_agg");

const sf = LuaStackFrame.lostFrame;
const emptyConfig = new Config();

// Unit tests per builtin

test("aggregate: sum", async () => {
  const result = await executeAggregate(
    sumSpec,
    jsToLuaValue([{ v: 10 }, { v: 20 }, { v: 30 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe(60);
});

test("aggregate: sum with nils", async () => {
  const result = await executeAggregate(
    sumSpec,
    jsToLuaValue([{ v: 5 }, { x: 1 }, { v: 15 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe(20);
});

test("aggregate: count with expression", async () => {
  const result = await executeAggregate(
    countSpec,
    jsToLuaValue([{ v: 1 }, { v: 2 }, { v: 3 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe(3);
});

test("aggregate: count with no argument (count(*))", async () => {
  const result = await executeAggregate(
    countSpec,
    jsToLuaValue([{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }]),
    null,
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe(4);
});

test("aggregate: min", async () => {
  const result = await executeAggregate(
    minSpec,
    jsToLuaValue([{ v: 30 }, { v: 10 }, { v: 20 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe(10);
});

test("aggregate: max", async () => {
  const result = await executeAggregate(
    maxSpec,
    jsToLuaValue([{ v: 30 }, { v: 10 }, { v: 20 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe(30);
});

test("aggregate: avg", async () => {
  const result = await executeAggregate(
    avgSpec,
    jsToLuaValue([{ v: 10 }, { v: 20 }, { v: 30 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe(20);
});

test("aggregate: avg empty group", async () => {
  const result = await executeAggregate(
    avgSpec,
    new LuaTable(),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBeNull();
});

test("aggregate: min/max on empty group", async () => {
  const items = new LuaTable();
  const env = new LuaEnv();
  const expr = parseExpressionString("_.v");
  expect(
    await executeAggregate(
      minSpec,
      items,
      expr,
      [],
      undefined,
      env,
      sf,
      evalExpression,
      emptyConfig,
    ),
  ).toBeNull();
  expect(
    await executeAggregate(
      maxSpec,
      items,
      expr,
      [],
      undefined,
      env,
      sf,
      evalExpression,
      emptyConfig,
    ),
  ).toBeNull();
});

test("aggregate: array_agg", async () => {
  const result = await executeAggregate(
    arrayAggSpec,
    jsToLuaValue([{ v: "a" }, { v: "b" }, { v: "c" }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBeInstanceOf(LuaTable);
  expect((result as LuaTable).rawGet(1)).toBe("a");
  expect((result as LuaTable).rawGet(2)).toBe("b");
  expect((result as LuaTable).rawGet(3)).toBe("c");
});

test("aggregate: sum with objectVariable", async () => {
  const result = await executeAggregate(
    sumSpec,
    jsToLuaValue([{ v: 3 }, { v: 7 }]),
    parseExpressionString("p.v"),
    [],
    "p",
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
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
  const config = makeConfig({ sum: customSum });
  const spec = getAggregateSpec("sum", config)!;
  const result = await executeAggregate(
    spec,
    jsToLuaValue([{ v: 1 }, { v: 2 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    config,
  );
  expect(result).toBe(103);
});

test("aggregate: builtin available without config", () => {
  const spec = getAggregateSpec("sum");
  expect(spec).not.toBeNull();
  expect(spec!.name).toBe("sum");

  const spec2 = getAggregateSpec("nonexistent");
  expect(spec2).toBeNull();
});

test("aggregate: sum with filter", async () => {
  const result = await executeAggregate(
    sumSpec,
    jsToLuaValue([{ v: 10 }, { v: 20 }, { v: 30 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    parseExpressionString("_.v > 10"),
  );
  expect(result).toBe(50);
});

test("aggregate: count with filter excludes all", async () => {
  const result = await executeAggregate(
    countSpec,
    jsToLuaValue([{ v: 1 }, { v: 2 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    parseExpressionString("_.v > 100"),
  );
  expect(result).toBe(0);
});

test("aggregate: array_agg with order by asc", async () => {
  const result = await executeAggregate(
    arrayAggSpec,
    jsToLuaValue([
      { v: "c", k: 3 },
      { v: "a", k: 1 },
      { v: "b", k: 2 },
    ]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    undefined,
    [makeOrderBy("_.k", "asc")],
  );
  expect(result).toBeInstanceOf(LuaTable);
  const tbl = result as LuaTable;
  expect(tbl.rawGet(1)).toBe("a");
  expect(tbl.rawGet(2)).toBe("b");
  expect(tbl.rawGet(3)).toBe("c");
});

test("aggregate: array_agg with order by desc", async () => {
  const result = await executeAggregate(
    arrayAggSpec,
    jsToLuaValue([
      { v: "c", k: 3 },
      { v: "a", k: 1 },
      { v: "b", k: 2 },
    ]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    undefined,
    [makeOrderBy("_.k", "desc")],
  );
  expect(result).toBeInstanceOf(LuaTable);
  const tbl = result as LuaTable;
  expect(tbl.rawGet(1)).toBe("c");
  expect(tbl.rawGet(2)).toBe("b");
  expect(tbl.rawGet(3)).toBe("a");
});

test("aggregate: array_agg with order by + filter combined", async () => {
  const result = await executeAggregate(
    arrayAggSpec,
    jsToLuaValue([
      { v: "d", k: 4 },
      { v: "a", k: 1 },
      { v: "c", k: 3 },
      { v: "b", k: 2 },
    ]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    parseExpressionString("_.k ~= 4"),
    [makeOrderBy("_.k", "asc")],
  );
  expect(result).toBeInstanceOf(LuaTable);
  const tbl = result as LuaTable;
  expect(tbl.length).toBe(3);
  expect(tbl.rawGet(1)).toBe("a");
  expect(tbl.rawGet(2)).toBe("b");
  expect(tbl.rawGet(3)).toBe("c");
});

test("aggregate: order by with nulls first", async () => {
  const result = await executeAggregate(
    arrayAggSpec,
    jsToLuaValue([{ v: "b", k: 2 }, { v: "x" }, { v: "a", k: 1 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    undefined,
    [makeOrderBy("_.k", "asc", "first")],
  );
  const tbl = result as LuaTable;
  expect(tbl.rawGet(1)).toBe("x");
  expect(tbl.rawGet(2)).toBe("a");
  expect(tbl.rawGet(3)).toBe("b");
});

test("aggregate: order by with nulls last", async () => {
  const result = await executeAggregate(
    arrayAggSpec,
    jsToLuaValue([{ v: "b", k: 2 }, { v: "x" }, { v: "a", k: 1 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    undefined,
    [makeOrderBy("_.k", "asc", "last")],
  );
  const tbl = result as LuaTable;
  expect(tbl.rawGet(1)).toBe("a");
  expect(tbl.rawGet(2)).toBe("b");
  expect(tbl.rawGet(3)).toBe("x");
});

test("aggregate: order by multiple keys", async () => {
  const result = await executeAggregate(
    arrayAggSpec,
    jsToLuaValue([
      { v: "c1", g: 2, k: 1 },
      { v: "a1", g: 1, k: 1 },
      { v: "a2", g: 1, k: 2 },
      { v: "c2", g: 2, k: 2 },
    ]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    undefined,
    [makeOrderBy("_.g", "asc"), makeOrderBy("_.k", "desc")],
  );
  const tbl = result as LuaTable;
  expect(tbl.rawGet(1)).toBe("a2");
  expect(tbl.rawGet(2)).toBe("a1");
  expect(tbl.rawGet(3)).toBe("c2");
  expect(tbl.rawGet(4)).toBe("c1");
});

test("aggregate: extra args passed to initialize/iterate/finish", async () => {
  const mulSumSpec: AggregateSpec = {
    name: "mul_sum",
    initialize: new LuaBuiltinFunction((_sf, _ctx: any, multiplier: any) => {
      return { total: 0, mul: multiplier ?? 1 };
    }),
    iterate: new LuaBuiltinFunction(
      (_sf, state: any, value: any, _ctx: any, multiplier: any) => {
        if (value === null || value === undefined) return state;
        state.total += (value as number) * (multiplier ?? state.mul);
        return state;
      },
    ),
    finish: new LuaBuiltinFunction((_sf, state: any) => {
      return state.total;
    }),
  };

  const result = await executeAggregate(
    mulSumSpec,
    jsToLuaValue([{ v: 2 }, { v: 3 }, { v: 5 }]),
    parseExpressionString("_.v"),
    [parseExpressionString("10")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe(100);
});

test("aggregate: extra args with no value expr", async () => {
  const basedCount: AggregateSpec = {
    name: "based_count",
    initialize: new LuaBuiltinFunction((_sf, _ctx: any, base: any) => {
      return base ?? 0;
    }),
    iterate: new LuaBuiltinFunction((_sf, state: any, _value: any) => {
      return (state as number) + 1;
    }),
  };

  const result = await executeAggregate(
    basedCount,
    jsToLuaValue([{ v: 1 }, { v: 2 }, { v: 3 }]),
    null,
    [parseExpressionString("100")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe(103);
});

test("evalExpressionWithAggregates: sum in table constructor", async () => {
  {
    const groupItems = jsToLuaValue([{ age: 10 }, { age: 20 }, { age: 30 }]);
    const env = new LuaEnv();
    const expr = parseExpressionString("{ total = sum(_.age) }");
    const result = await evalExpressionWithAggregates(
      expr,
      env,
      sf,
      groupItems,
      undefined,
      env,
      emptyConfig,
    );
    expect(result).toBeInstanceOf(LuaTable);
    expect((result as LuaTable).rawGet("total")).toBe(60);
  }
});

test("evalExpressionWithAggregates: count() with no args", async () => {
  {
    const groupItems = jsToLuaValue([{ x: 1 }, { x: 2 }, { x: 3 }]);
    const env = new LuaEnv();
    const expr = parseExpressionString("count()");
    const result = await evalExpressionWithAggregates(
      expr,
      env,
      sf,
      groupItems,
      undefined,
      env,
      emptyConfig,
    );
    expect(result).toBe(3);
  }
});

test("evalExpressionWithAggregates: non-aggregate falls through", async () => {
  {
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
      emptyConfig,
    );
    expect(result).toBe("hello");
  }
});

test("evalExpressionWithAggregates: multiple aggregates in table", async () => {
  {
    const groupItems = jsToLuaValue([{ v: 5 }, { v: 15 }, { v: 10 }]);
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
      emptyConfig,
    );
    const tbl = result as LuaTable;
    expect(tbl.rawGet("k")).toBe("grp1");
    expect(tbl.rawGet("total")).toBe(30);
    expect(tbl.rawGet("n")).toBe(3);
    expect(tbl.rawGet("smallest")).toBe(5);
  }
});

test("evalExpressionWithAggregates: avg with finish step", async () => {
  {
    const groupItems = jsToLuaValue([{ v: 10 }, { v: 30 }]);
    const env = new LuaEnv();
    const expr = parseExpressionString("avg(_.v)");
    const result = await evalExpressionWithAggregates(
      expr,
      env,
      sf,
      groupItems,
      undefined,
      env,
      emptyConfig,
    );
    expect(result).toBe(20);
  }
});

test("evalExpressionWithAggregates: binary comparison (count > N)", async () => {
  {
    const groupItems = jsToLuaValue([{ v: 1 }, { v: 2 }, { v: 3 }]);
    const env = new LuaEnv();
    const result = await evalExpressionWithAggregates(
      parseExpressionString("count(_.v) > 2"),
      env,
      sf,
      groupItems,
      undefined,
      env,
      emptyConfig,
    );
    expect(result).toBe(true);
  }
});

test("evalExpressionWithAggregates: binary arithmetic (sum + sum)", async () => {
  {
    const groupItems = jsToLuaValue([
      { a: 10, b: 5 },
      { a: 20, b: 15 },
    ]);
    const env = new LuaEnv();
    const result = await evalExpressionWithAggregates(
      parseExpressionString("sum(_.a) + sum(_.b)"),
      env,
      sf,
      groupItems,
      undefined,
      env,
      emptyConfig,
    );
    expect(result).toBe(50);
  }
});

test("evalExpressionWithAggregates: unary minus on aggregate", async () => {
  {
    const groupItems = jsToLuaValue([{ v: 10 }, { v: 20 }]);
    const env = new LuaEnv();
    const result = await evalExpressionWithAggregates(
      parseExpressionString("-sum(_.v)"),
      env,
      sf,
      groupItems,
      undefined,
      env,
      emptyConfig,
    );
    expect(result).toBe(-30);
  }
});

test("evalExpressionWithAggregates: parenthesized aggregate", async () => {
  {
    const groupItems = jsToLuaValue([{ v: 7 }, { v: 3 }]);
    const env = new LuaEnv();
    const result = await evalExpressionWithAggregates(
      parseExpressionString("(sum(_.v))"),
      env,
      sf,
      groupItems,
      undefined,
      env,
      emptyConfig,
    );
    expect(result).toBe(10);
  }
});

test("evalExpressionWithAggregates: and short-circuit", async () => {
  {
    const groupItems = jsToLuaValue([{ v: 1 }]);
    const env = new LuaEnv();
    expect(
      await evalExpressionWithAggregates(
        parseExpressionString("count(_.v) and 42"),
        env,
        sf,
        groupItems,
        undefined,
        env,
        emptyConfig,
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
        emptyConfig,
      ),
    ).toBe(false);
  }
});

test("evalExpressionWithAggregates: or short-circuit", async () => {
  {
    const groupItems = jsToLuaValue([{ v: 1 }]);
    const env = new LuaEnv();
    expect(
      await evalExpressionWithAggregates(
        parseExpressionString("count(_.v) or 99"),
        env,
        sf,
        groupItems,
        undefined,
        env,
        emptyConfig,
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
        emptyConfig,
      ),
    ).toBe(1);
  }
});

test("evalExpressionWithAggregates: not aggregate", async () => {
  {
    const groupItems = jsToLuaValue([{ v: 1 }]);
    const env = new LuaEnv();
    expect(
      await evalExpressionWithAggregates(
        parseExpressionString("not count(_.v)"),
        env,
        sf,
        groupItems,
        undefined,
        env,
        emptyConfig,
      ),
    ).toBe(false);
  }
});

test("applyQuery: group by + select with aggregates", async () => {
  {
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
  }
});

test("applyQuery: group by + having with aggregate", async () => {
  {
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
    );
    expect(results.length).toBe(1);
    expect((results[0] as LuaTable).rawGet("key")).toBe("eng");
  }
});

test("applyQuery: group by without aggregates still works", async () => {
  {
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
    );
    expect(results.length).toBe(2);
    expect(results[0]).toBe("eng");
    expect(results[1]).toBe("sales");
  }
});

test("applyQuery: having with compound expression", async () => {
  {
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
    );
    expect(results.length).toBe(1);
    expect((results[0] as LuaTable).rawGet("dept")).toBe("eng");
    expect((results[0] as LuaTable).rawGet("total")).toBe(300);
  }
});

test("applyQuery: implicit _ with group by + multiple aggregates", async () => {
  {
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
  }
});

test("applyQuery: group by + having + order by + limit", async () => {
  {
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
    );
    expect(results.length).toBe(1);
    expect(results[0]).toBe("a");
  }
});

test("applyQuery: select with aggregate division (float result)", async () => {
  {
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
    );
    expect(results.length).toBe(1);
    const row = results[0] as LuaTable;
    expect(row.rawGet("dept")).toBe("eng");
    expect(luaValueToJS(row.rawGet("avg_salary"), sf)).toBe(150);
  }
});

test("aggregate: custom concat with finish", async () => {
  const concatSpec: AggregateSpec = {
    name: "concat",
    initialize: new LuaBuiltinFunction(
      (_sf) => new LuaTable({ first: true, s: "" }),
    ),
    iterate: new LuaBuiltinFunction((_sf, state: any, value: any) => {
      if (value === null || value === undefined) return state;
      if (state.rawGet("first")) {
        state.rawSet("s", String(value));
        state.rawSet("first", false);
      } else {
        state.rawSet("s", `${state.rawGet("s")}, ${String(value)}`);
      }
      return state;
    }),
    finish: new LuaBuiltinFunction((_sf, state: any) => state.rawGet("s")),
  };
  const result = await executeAggregate(
    concatSpec,
    jsToLuaValue([{ v: "a" }, { v: "b" }, { v: "c" }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe("a, b, c");
});

test("aggregate: extra args - no extra args (default)", async () => {
  const concatSpec: AggregateSpec = {
    name: "concat",
    initialize: new LuaBuiltinFunction((_sf, _ctx: any, sep: any) => {
      return { sep: sep ?? ", ", parts: [] as string[] };
    }),
    iterate: new LuaBuiltinFunction(
      (_sf, state: any, value: any, _ctx: any) => {
        if (value !== null && value !== undefined) {
          state.parts.push(String(value));
        }
        return state;
      },
    ),
    finish: new LuaBuiltinFunction((_sf, state: any) => {
      return state.parts.join(state.sep);
    }),
  };

  const result = await executeAggregate(
    concatSpec,
    jsToLuaValue([{ v: "Alice" }, { v: "Bob" }, { v: "Carol" }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe("Alice, Bob, Carol");
});

test("aggregate: extra args - single extra arg (custom separator)", async () => {
  const concatSpec: AggregateSpec = {
    name: "concat",
    initialize: new LuaBuiltinFunction((_sf, _ctx: any, sep: any) => {
      return { sep: sep ?? ", ", parts: [] as string[] };
    }),
    iterate: new LuaBuiltinFunction(
      (_sf, state: any, value: any, _ctx: any) => {
        if (value !== null && value !== undefined) {
          state.parts.push(String(value));
        }
        return state;
      },
    ),
    finish: new LuaBuiltinFunction((_sf, state: any) => {
      return state.parts.join(state.sep);
    }),
  };

  const result = await executeAggregate(
    concatSpec,
    jsToLuaValue([{ v: "Alice" }, { v: "Bob" }, { v: "Carol" }]),
    parseExpressionString("_.v"),
    [parseExpressionString("' - '")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe("Alice - Bob - Carol");
});

test("aggregate: extra args - two extra args (separator + prefix)", async () => {
  const concat2Spec: AggregateSpec = {
    name: "concat2",
    initialize: new LuaBuiltinFunction(
      (_sf, _ctx: any, sep: any, prefix: any) => {
        return {
          sep: sep ?? ", ",
          prefix: prefix ?? "",
          parts: [] as string[],
        };
      },
    ),
    iterate: new LuaBuiltinFunction(
      (_sf, state: any, value: any, _ctx: any) => {
        if (value !== null && value !== undefined) {
          state.parts.push(String(value));
        }
        return state;
      },
    ),
    finish: new LuaBuiltinFunction((_sf, state: any) => {
      return state.prefix + state.parts.join(state.sep);
    }),
  };

  const result = await executeAggregate(
    concat2Spec,
    jsToLuaValue([{ v: "Alice" }, { v: "Bob" }, { v: "Carol" }]),
    parseExpressionString("_.v"),
    [parseExpressionString("' | '"), parseExpressionString("'Names: '")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe("Names: Alice | Bob | Carol");
});

test("aggregate: extra args + filter", async () => {
  const concatSpec: AggregateSpec = {
    name: "concat",
    initialize: new LuaBuiltinFunction((_sf, _ctx: any, sep: any) => {
      return { sep: sep ?? ", ", parts: [] as string[] };
    }),
    iterate: new LuaBuiltinFunction(
      (_sf, state: any, value: any, _ctx: any) => {
        if (value !== null && value !== undefined) {
          state.parts.push(String(value));
        }
        return state;
      },
    ),
    finish: new LuaBuiltinFunction((_sf, state: any) => {
      return state.parts.join(state.sep);
    }),
  };

  const result = await executeAggregate(
    concatSpec,
    jsToLuaValue([
      { v: "Alice", age: 31 },
      { v: "Bob", age: 25 },
      { v: "Carol", age: 41 },
    ]),
    parseExpressionString("_.v"),
    [parseExpressionString("' + '")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    parseExpressionString("_.age > 30"),
  );
  expect(result).toBe("Alice + Carol");
});

test("aggregate: extra args + order by", async () => {
  const concatSpec: AggregateSpec = {
    name: "concat",
    initialize: new LuaBuiltinFunction((_sf, _ctx: any, sep: any) => {
      return { sep: sep ?? ", ", parts: [] as string[] };
    }),
    iterate: new LuaBuiltinFunction(
      (_sf, state: any, value: any, _ctx: any) => {
        if (value !== null && value !== undefined) {
          state.parts.push(String(value));
        }
        return state;
      },
    ),
    finish: new LuaBuiltinFunction((_sf, state: any) => {
      return state.parts.join(state.sep);
    }),
  };

  const resultNoOrder = await executeAggregate(
    concatSpec,
    jsToLuaValue([
      { v: "Carol", k: 3 },
      { v: "Alice", k: 1 },
      { v: "Bob", k: 2 },
    ]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(resultNoOrder).toBe("Carol, Alice, Bob");

  const resultOrdered = await executeAggregate(
    concatSpec,
    jsToLuaValue([
      { v: "Carol", k: 3 },
      { v: "Alice", k: 1 },
      { v: "Bob", k: 2 },
    ]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    undefined,
    [makeOrderBy("_.k", "asc")],
  );
  expect(resultOrdered).toBe("Alice, Bob, Carol");
});

test("aggregate: extra args + order by + filter combined", async () => {
  const concatSpec: AggregateSpec = {
    name: "concat",
    initialize: new LuaBuiltinFunction((_sf, _ctx: any, sep: any) => {
      return { sep: sep ?? ", ", parts: [] as string[] };
    }),
    iterate: new LuaBuiltinFunction(
      (_sf, state: any, value: any, _ctx: any) => {
        if (value !== null && value !== undefined) {
          state.parts.push(String(value));
        }
        return state;
      },
    ),
    finish: new LuaBuiltinFunction((_sf, state: any) => {
      return state.parts.join(state.sep);
    }),
  };

  const result = await executeAggregate(
    concatSpec,
    jsToLuaValue([
      { v: "Carol", k: 3, age: 41 },
      { v: "Alice", k: 1, age: 31 },
      { v: "Bob", k: 2, age: 25 },
      { v: "Dave", k: 4, age: 52 },
    ]),
    parseExpressionString("_.v"),
    [parseExpressionString("' | '")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    parseExpressionString("_.age > 30"),
    [makeOrderBy("_.k", "desc")],
  );
  expect(result).toBe("Dave | Carol | Alice");
});

test("aggregate: extra args forwarded to finish", async () => {
  const wrapSpec: AggregateSpec = {
    name: "wrap_agg",
    initialize: new LuaBuiltinFunction((_sf, _ctx: any) => {
      return { parts: [] as string[] };
    }),
    iterate: new LuaBuiltinFunction(
      (_sf, state: any, value: any, _ctx: any) => {
        if (value !== null && value !== undefined) {
          state.parts.push(String(value));
        }
        return state;
      },
    ),
    finish: new LuaBuiltinFunction(
      (_sf, state: any, _ctx: any, open: any, close: any) => {
        const inner = state.parts.join(", ");
        return (open ?? "[") + inner + (close ?? "]");
      },
    ),
  };

  const result = await executeAggregate(
    wrapSpec,
    jsToLuaValue([{ v: "a" }, { v: "b" }, { v: "c" }]),
    parseExpressionString("_.v"),
    [parseExpressionString("'('"), parseExpressionString("')'")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe("(a, b, c)");

  const result2 = await executeAggregate(
    wrapSpec,
    jsToLuaValue([{ v: "x" }, { v: "y" }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result2).toBe("[x, y]");
});
