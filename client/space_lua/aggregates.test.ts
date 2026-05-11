import { parseExpressionString } from "./parse.ts";
import { evalExpression } from "./eval.ts";
import {
  type AggregateSpec,
  executeAggregate,
  getAggregateSpec,
  validateAggregateWildcardArg,
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
const productSpec = requireSpec("product");
const stringAggSpec = requireSpec("string_agg");
const yamlAggSpec = requireSpec("yaml_agg");
const jsonAggSpec = requireSpec("json_agg");
const bitAndSpec = requireSpec("bit_and");
const bitOrSpec = requireSpec("bit_or");
const bitXorSpec = requireSpec("bit_xor");
const boolAndSpec = requireSpec("bool_and");
const boolOrSpec = requireSpec("bool_or");
const stddevPopSpec = requireSpec("stddev_pop");
const stddevSampSpec = requireSpec("stddev_samp");
const varPopSpec = requireSpec("var_pop");
const varSampSpec = requireSpec("var_samp");
const covarPopSpec = requireSpec("covar_pop");
const covarSampSpec = requireSpec("covar_samp");
const corrSpec = requireSpec("corr");
const quantileSpec = requireSpec("quantile");
const percentileContSpec = requireSpec("percentile_cont");
const percentileDiscSpec = requireSpec("percentile_disc");
const modeSpec = requireSpec("mode");
const firstSpec = requireSpec("first");
const lastSpec = requireSpec("last");
const medianSpec = requireSpec("median");

const sf = LuaStackFrame.lostFrame;
const emptyConfig = new Config();

// Unit tests per builtin

test("aggregate: sum", async () => {
  const { value: result } = await executeAggregate(
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
  const { value: result } = await executeAggregate(
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

test("aggregate: sum empty group", async () => {
  const { value: result } = await executeAggregate(
    sumSpec,
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

test("aggregate: count with expression", async () => {
  const { value: result } = await executeAggregate(
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
  const { value: result } = await executeAggregate(
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
  const { value: result } = await executeAggregate(
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
  const { value: result } = await executeAggregate(
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
  const { value: result } = await executeAggregate(
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
  const { value: result } = await executeAggregate(
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
    (
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
      )
    ).value,
  ).toBeNull();
  expect(
    (
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
      )
    ).value,
  ).toBeNull();
});

test("aggregate: array_agg", async () => {
  const { value: result } = await executeAggregate(
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

test("aggregate: product", async () => {
  const { value: result } = await executeAggregate(
    productSpec,
    jsToLuaValue([{ v: 2 }, { v: 3 }, { v: 5 }]),
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

test("aggregate: product with nils", async () => {
  const { value: result } = await executeAggregate(
    productSpec,
    jsToLuaValue([{ v: 4 }, { x: 1 }, { v: 5 }]),
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

test("aggregate: product empty group", async () => {
  const { value: result } = await executeAggregate(
    productSpec,
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

test("aggregate: string_agg", async () => {
  const { value: result } = await executeAggregate(
    stringAggSpec,
    jsToLuaValue([{ v: "a" }, { v: "b" }, { v: "c" }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe("a,b,c");
});

test("aggregate: string_agg with custom separator", async () => {
  const { value: result } = await executeAggregate(
    stringAggSpec,
    jsToLuaValue([{ v: "x" }, { v: "y" }]),
    parseExpressionString("_.v"),
    [parseExpressionString("' | '")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe("x | y");
});

test("aggregate: string_agg skips nils", async () => {
  const { value: result } = await executeAggregate(
    stringAggSpec,
    jsToLuaValue([{ v: "a" }, { x: 1 }, { v: "b" }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe("a,b");
});

test("aggregate: yaml_agg", async () => {
  const { value: result } = await executeAggregate(
    yamlAggSpec,
    jsToLuaValue([{ v: 1 }, { v: 2 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(typeof result).toBe("string");
  expect((result as string).trim()).toBe("- 1\n- 2");
});

test("aggregate: json_agg", async () => {
  const { value: result } = await executeAggregate(
    jsonAggSpec,
    jsToLuaValue([{ v: 1 }, { v: "hello" }, { v: true }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe('[1,"hello",true]');
});

test("aggregate: bit_and", async () => {
  const { value: result } = await executeAggregate(
    bitAndSpec,
    jsToLuaValue([{ v: 0b1111 }, { v: 0b1010 }, { v: 0b1100 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe(0b1000);
});

test("aggregate: bit_and empty group", async () => {
  const { value: result } = await executeAggregate(
    bitAndSpec,
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

test("aggregate: bit_or", async () => {
  const { value: result } = await executeAggregate(
    bitOrSpec,
    jsToLuaValue([{ v: 0b0001 }, { v: 0b0010 }, { v: 0b0100 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe(0b0111);
});

test("aggregate: bit_or empty group", async () => {
  const { value: result } = await executeAggregate(
    bitOrSpec,
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

test("aggregate: bit_xor", async () => {
  const { value: result } = await executeAggregate(
    bitXorSpec,
    jsToLuaValue([{ v: 0b1010 }, { v: 0b1100 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe(0b0110);
});

test("aggregate: bit_xor empty group", async () => {
  const { value: result } = await executeAggregate(
    bitXorSpec,
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

test("aggregate: bool_and all true", async () => {
  const { value: result } = await executeAggregate(
    boolAndSpec,
    jsToLuaValue([{ v: true }, { v: true }, { v: true }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe(true);
});

test("aggregate: bool_and with false", async () => {
  const { value: result } = await executeAggregate(
    boolAndSpec,
    jsToLuaValue([{ v: true }, { v: false }, { v: true }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe(false);
});

test("aggregate: bool_and empty group", async () => {
  const { value: result } = await executeAggregate(
    boolAndSpec,
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

test("aggregate: bool_or all false", async () => {
  const { value: result } = await executeAggregate(
    boolOrSpec,
    jsToLuaValue([{ v: false }, { v: false }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe(false);
});

test("aggregate: bool_or with true", async () => {
  const { value: result } = await executeAggregate(
    boolOrSpec,
    jsToLuaValue([{ v: false }, { v: true }, { v: false }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe(true);
});

test("aggregate: bool_or empty group", async () => {
  const { value: result } = await executeAggregate(
    boolOrSpec,
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

test("aggregate: stddev_pop", async () => {
  // values: 2, 4, 4, 4, 5, 5, 7, 9 yields: mean=5, var_pop=4, stddev_pop=2
  const { value: result } = await executeAggregate(
    stddevPopSpec,
    jsToLuaValue([
      { v: 2 },
      { v: 4 },
      { v: 4 },
      { v: 4 },
      { v: 5 },
      { v: 5 },
      { v: 7 },
      { v: 9 },
    ]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBeCloseTo(2, 10);
});

test("aggregate: stddev_pop empty group", async () => {
  const { value: result } = await executeAggregate(
    stddevPopSpec,
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

test("aggregate: stddev_samp", async () => {
  // values: 2, 4, 4, 4, 5, 5, 7, 9 yields: var_samp = 32/7, stddev_samp = sqrt(32/7)
  const { value: result } = await executeAggregate(
    stddevSampSpec,
    jsToLuaValue([
      { v: 2 },
      { v: 4 },
      { v: 4 },
      { v: 4 },
      { v: 5 },
      { v: 5 },
      { v: 7 },
      { v: 9 },
    ]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBeCloseTo(Math.sqrt(32 / 7), 10);
});

test("aggregate: stddev_samp single element", async () => {
  const { value: result } = await executeAggregate(
    stddevSampSpec,
    jsToLuaValue([{ v: 42 }]),
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

test("aggregate: var_pop", async () => {
  // values: 2, 4, 4, 4, 5, 5, 7, 9 yields: var_pop = 4
  const { value: result } = await executeAggregate(
    varPopSpec,
    jsToLuaValue([
      { v: 2 },
      { v: 4 },
      { v: 4 },
      { v: 4 },
      { v: 5 },
      { v: 5 },
      { v: 7 },
      { v: 9 },
    ]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBeCloseTo(4, 10);
});

test("aggregate: var_pop empty group", async () => {
  const { value: result } = await executeAggregate(
    varPopSpec,
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

test("aggregate: var_samp", async () => {
  // values: 2, 4, 4, 4, 5, 5, 7, 9 yields: var_samp = 32/7
  const { value: result } = await executeAggregate(
    varSampSpec,
    jsToLuaValue([
      { v: 2 },
      { v: 4 },
      { v: 4 },
      { v: 4 },
      { v: 5 },
      { v: 5 },
      { v: 7 },
      { v: 9 },
    ]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBeCloseTo(32 / 7, 10);
});

test("aggregate: var_samp single element", async () => {
  const { value: result } = await executeAggregate(
    varSampSpec,
    jsToLuaValue([{ v: 42 }]),
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

test("aggregate: covar_pop", async () => {
  // x: 1,2,3,4,5  y: 2,4,5,4,5 yields: covar_pop = 6/5 = 1.2
  const { value: result } = await executeAggregate(
    covarPopSpec,
    jsToLuaValue([
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 5 },
      { x: 4, y: 4 },
      { x: 5, y: 5 },
    ]),
    parseExpressionString("_.y"),
    [parseExpressionString("_.x")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBeCloseTo(1.2, 10);
});

test("aggregate: covar_pop empty group", async () => {
  const { value: result } = await executeAggregate(
    covarPopSpec,
    new LuaTable(),
    parseExpressionString("_.y"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBeNull();
});

test("aggregate: covar_pop skips null pairs", async () => {
  const { value: result } = await executeAggregate(
    covarPopSpec,
    jsToLuaValue([
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 5 },
      { x: 4, y: 4 },
      { x: 5, y: 5 },
      { y: 99 }, // x is nil
      { x: 6 }, // y is nil
    ]),
    parseExpressionString("_.y"),
    [parseExpressionString("_.x")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  // Same 5 valid pairs yields: covar_pop = 6/5 = 1.2
  expect(result).toBeCloseTo(1.2, 10);
});

test("aggregate: covar_samp", async () => {
  // x: 1,2,3,4,5  y: 2,4,5,4,5 yields: covar_samp = 6/4 = 1.5
  const { value: result } = await executeAggregate(
    covarSampSpec,
    jsToLuaValue([
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 5 },
      { x: 4, y: 4 },
      { x: 5, y: 5 },
    ]),
    parseExpressionString("_.y"),
    [parseExpressionString("_.x")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBeCloseTo(1.5, 10);
});

test("aggregate: covar_samp single element", async () => {
  const { value: result } = await executeAggregate(
    covarSampSpec,
    jsToLuaValue([{ x: 1, y: 2 }]),
    parseExpressionString("_.y"),
    [parseExpressionString("_.x")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBeNull();
});

test("aggregate: corr", async () => {
  // x: 1,2,3,4,5  y: 2,4,6,8,10  (perfect positive linear)
  const { value: result } = await executeAggregate(
    corrSpec,
    jsToLuaValue([
      { x: 1, y: 2 },
      { x: 2, y: 4 },
      { x: 3, y: 6 },
      { x: 4, y: 8 },
      { x: 5, y: 10 },
    ]),
    parseExpressionString("_.y"),
    [parseExpressionString("_.x")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBeCloseTo(1.0, 10);
});

test("aggregate: corr single element", async () => {
  const { value: result } = await executeAggregate(
    corrSpec,
    jsToLuaValue([{ x: 1, y: 2 }]),
    parseExpressionString("_.y"),
    [parseExpressionString("_.x")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBeNull();
});

test("aggregate: corr constant x returns null", async () => {
  // All x identical yields: zero variance in x yields: denom = 0 yields: null
  const { value: result } = await executeAggregate(
    corrSpec,
    jsToLuaValue([
      { x: 3, y: 1 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
    ]),
    parseExpressionString("_.y"),
    [parseExpressionString("_.x")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBeNull();
});

test("aggregate: quantile (linear, default)", async () => {
  // Pre-sorted input; median of [1,2,3,4,5] at q=0.5 yields: 3
  const { value: result } = await executeAggregate(
    quantileSpec,
    jsToLuaValue([{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }]),
    parseExpressionString("_.v"),
    [parseExpressionString("0.5")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    undefined,
    [makeOrderBy("_.v", "asc")],
  );
  expect(result).toBe(3);
});

test("aggregate: quantile empty group", async () => {
  const { value: result } = await executeAggregate(
    quantileSpec,
    new LuaTable(),
    parseExpressionString("_.v"),
    [parseExpressionString("0.5")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBeNull();
});

test("aggregate: quantile with lower method", async () => {
  // [10, 20, 30, 40] q=0.3 yields: idx=0.9, lower yields: values[0] = 10
  const { value: result } = await executeAggregate(
    quantileSpec,
    jsToLuaValue([{ v: 10 }, { v: 20 }, { v: 30 }, { v: 40 }]),
    parseExpressionString("_.v"),
    [parseExpressionString("0.3"), parseExpressionString("'lower'")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    undefined,
    [makeOrderBy("_.v", "asc")],
  );
  expect(result).toBe(10);
});

test("aggregate: quantile with higher method", async () => {
  // [10, 20, 30, 40] q=0.3 yields: idx=0.9, higher yields: values[1] = 20
  const { value: result } = await executeAggregate(
    quantileSpec,
    jsToLuaValue([{ v: 10 }, { v: 20 }, { v: 30 }, { v: 40 }]),
    parseExpressionString("_.v"),
    [parseExpressionString("0.3"), parseExpressionString("'higher'")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    undefined,
    [makeOrderBy("_.v", "asc")],
  );
  expect(result).toBe(20);
});

test("aggregate: quantile with midpoint method", async () => {
  // [10, 20, 30, 40] q=0.3 yields: idx=0.9, midpoint yields: (10+20)/2 = 15
  const { value: result } = await executeAggregate(
    quantileSpec,
    jsToLuaValue([{ v: 10 }, { v: 20 }, { v: 30 }, { v: 40 }]),
    parseExpressionString("_.v"),
    [parseExpressionString("0.3"), parseExpressionString("'midpoint'")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    undefined,
    [makeOrderBy("_.v", "asc")],
  );
  expect(result).toBe(15);
});

test("aggregate: quantile with nearest method", async () => {
  // [10, 20, 30, 40] q=0.3 yields: idx=0.9 (0.9-0=0.9 > 0.5 yields: higher) yields: 20
  const { value: result } = await executeAggregate(
    quantileSpec,
    jsToLuaValue([{ v: 10 }, { v: 20 }, { v: 30 }, { v: 40 }]),
    parseExpressionString("_.v"),
    [parseExpressionString("0.3"), parseExpressionString("'nearest'")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    undefined,
    [makeOrderBy("_.v", "asc")],
  );
  expect(result).toBe(20);
});

test("aggregate: percentile_cont", async () => {
  // [1,2,3,4,5] q=0.25 yields: idx=1.0 yields: values[1]=2 (linear, exact)
  const { value: result } = await executeAggregate(
    percentileContSpec,
    jsToLuaValue([{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }]),
    parseExpressionString("_.v"),
    [parseExpressionString("0.25")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    undefined,
    [makeOrderBy("_.v", "asc")],
  );
  expect(result).toBe(2);
});

test("aggregate: percentile_cont interpolation", async () => {
  // [10, 20, 30, 40] q=0.5 yields: idx=1.5 yields: 20 + 0.5*(30-20) = 25
  const { value: result } = await executeAggregate(
    percentileContSpec,
    jsToLuaValue([{ v: 10 }, { v: 20 }, { v: 30 }, { v: 40 }]),
    parseExpressionString("_.v"),
    [parseExpressionString("0.5")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    undefined,
    [makeOrderBy("_.v", "asc")],
  );
  expect(result).toBe(25);
});

test("aggregate: percentile_disc", async () => {
  // [1,2,3,4,5] q=0.4 yields: idx=1.6, lower yields: values[1]=2
  const { value: result } = await executeAggregate(
    percentileDiscSpec,
    jsToLuaValue([{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }]),
    parseExpressionString("_.v"),
    [parseExpressionString("0.4")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    undefined,
    [makeOrderBy("_.v", "asc")],
  );
  expect(result).toBe(2);
});

test("aggregate: percentile_disc at boundary", async () => {
  // [10, 20, 30] q=0 yields: idx=0, lower yields: values[0]=10
  const { value: result } = await executeAggregate(
    percentileDiscSpec,
    jsToLuaValue([{ v: 10 }, { v: 20 }, { v: 30 }]),
    parseExpressionString("_.v"),
    [parseExpressionString("0")],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    undefined,
    [makeOrderBy("_.v", "asc")],
  );
  expect(result).toBe(10);
});

test("aggregate: sum with objectVariable", async () => {
  const { value: result } = await executeAggregate(
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
  const { value: result } = await executeAggregate(
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
  const { value: result } = await executeAggregate(
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
  const { value: result } = await executeAggregate(
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
  const { value: result } = await executeAggregate(
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
  const { value: result } = await executeAggregate(
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
  const { value: result } = await executeAggregate(
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
  const { value: result } = await executeAggregate(
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
  const { value: result } = await executeAggregate(
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
  const { value: result } = await executeAggregate(
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

  const { value: result } = await executeAggregate(
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

  const { value: result } = await executeAggregate(
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
        groupBy: [{ expr: parseExpressionString("p.dept") }],
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
        groupBy: [{ expr: parseExpressionString("p.dept") }],
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
        groupBy: [{ expr: parseExpressionString("p.dept") }],
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
        groupBy: [{ expr: parseExpressionString("p.dept") }],
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
        groupBy: [{ expr: parseExpressionString("_.category") }],
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
        groupBy: [{ expr: parseExpressionString("t.tag") }],
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
        groupBy: [{ expr: parseExpressionString("p.dept") }],
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
  const { value: result } = await executeAggregate(
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

  const { value: result } = await executeAggregate(
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

  const { value: result } = await executeAggregate(
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

  const { value: result } = await executeAggregate(
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

  const { value: result } = await executeAggregate(
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

  const { value: resultNoOrder } = await executeAggregate(
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

  const { value: resultOrdered } = await executeAggregate(
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

  const { value: result } = await executeAggregate(
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

  const { value: result } = await executeAggregate(
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

  const { value: result2 } = await executeAggregate(
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

test("aggregate: mode returns most frequent value", async () => {
  const { value: result } = await executeAggregate(
    modeSpec,
    jsToLuaValue([{ v: "a" }, { v: "b" }, { v: "a" }, { v: "c" }, { v: "a" }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe("a");
});

test("aggregate: mode with tie returns first to reach max", async () => {
  // a appears at index 1,3 ; b at index 2,4 — a reaches count=2 first
  const { value: result } = await executeAggregate(
    modeSpec,
    jsToLuaValue([{ v: "a" }, { v: "b" }, { v: "a" }, { v: "b" }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe("a");
});

test("aggregate: mode on empty group", async () => {
  const { value: result } = await executeAggregate(
    modeSpec,
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

test("aggregate: mode skips nulls", async () => {
  const { value: result } = await executeAggregate(
    modeSpec,
    jsToLuaValue([{ v: "x" }, { z: 1 }, { z: 2 }, { v: "x" }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe("x");
});

test("aggregate: mode with numbers", async () => {
  const { value: result } = await executeAggregate(
    modeSpec,
    jsToLuaValue([{ v: 3 }, { v: 1 }, { v: 3 }, { v: 2 }, { v: 1 }, { v: 3 }]),
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

// first

test("aggregate: first returns first non-null value", async () => {
  const { value: result } = await executeAggregate(
    firstSpec,
    jsToLuaValue([{ v: "a" }, { v: "b" }, { v: "c" }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe("a");
});

test("aggregate: first skips leading nulls", async () => {
  const { value: result } = await executeAggregate(
    firstSpec,
    jsToLuaValue([{ z: 1 }, { z: 2 }, { v: "found" }, { v: "skip" }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe("found");
});

test("aggregate: first on empty group", async () => {
  const { value: result } = await executeAggregate(
    firstSpec,
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

test("aggregate: first with order by", async () => {
  const { value: result } = await executeAggregate(
    firstSpec,
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
  expect(result).toBe("a");
});

test("aggregate: last returns last non-null value", async () => {
  const { value: result } = await executeAggregate(
    lastSpec,
    jsToLuaValue([{ v: "a" }, { v: "b" }, { v: "c" }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe("c");
});

test("aggregate: last skips trailing nulls", async () => {
  const { value: result } = await executeAggregate(
    lastSpec,
    jsToLuaValue([{ v: "a" }, { v: "last" }, { z: 1 }, { z: 2 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe("last");
});

test("aggregate: last on empty group", async () => {
  const { value: result } = await executeAggregate(
    lastSpec,
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

test("aggregate: last with order by desc", async () => {
  const { value: result } = await executeAggregate(
    lastSpec,
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
  // desc order: c(3), b(2), a(1) -> last = "a"
  expect(result).toBe("a");
});

test("aggregate: median of odd count", async () => {
  const { value: result } = await executeAggregate(
    medianSpec,
    jsToLuaValue([{ v: 30 }, { v: 10 }, { v: 20 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    undefined,
    [makeOrderBy("_.v", "asc")],
  );
  expect(result).toBe(20);
});

test("aggregate: median of even count (interpolated)", async () => {
  const { value: result } = await executeAggregate(
    medianSpec,
    jsToLuaValue([{ v: 10 }, { v: 20 }, { v: 30 }, { v: 40 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
    undefined,
    [makeOrderBy("_.v", "asc")],
  );
  // [10,20,30,40] q=0.5 -> idx=1.5 -> 20 + 0.5*(30-20) = 25
  expect(result).toBe(25);
});

test("aggregate: median on empty group", async () => {
  const { value: result } = await executeAggregate(
    medianSpec,
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

test("aggregate: median single element", async () => {
  const { value: result } = await executeAggregate(
    medianSpec,
    jsToLuaValue([{ v: 42 }]),
    parseExpressionString("_.v"),
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    emptyConfig,
  );
  expect(result).toBe(42);
});

// Custom-aggregate wildcard contract: same opt-in default as the built-ins.
// Aggregates without `acceptsWildcardArg` reject `<agg>(*)` / `<agg>(t.*)`,
// protecting naive `state += value` iterators from JS string coercion.

test("aggregate: custom without acceptsWildcardArg rejects wildcards", () => {
  const scalarSum: AggregateSpec = {
    name: "scalar_sum",
    initialize: new LuaBuiltinFunction((_sf) => 0),
    iterate: new LuaBuiltinFunction((_sf, state: any, value: any) => {
      if (value === null || value === undefined) return state;
      return (state as number) + (value as number);
    }),
  };
  const config = makeConfig({ scalar_sum: scalarSum });
  const spec = getAggregateSpec("scalar_sum", config)!;
  expect(spec.acceptsWildcardArg).toBeFalsy();

  // `*` is rejected
  expect(() =>
    validateAggregateWildcardArg(spec, { kind: "all" }, sf),
  ).toThrowError(/aggregate 'scalar_sum'.*'\*'/);

  // `<src>.*` is rejected, error names the offending wildcard.
  expect(() =>
    validateAggregateWildcardArg(spec, { kind: "source", source: "t" }, sf),
  ).toThrowError(/aggregate 'scalar_sum'.*'t\.\*'/);
});

test("aggregate: custom with acceptsWildcardArg accepts wildcards", async () => {
  const rowCount: AggregateSpec = {
    name: "row_count",
    acceptsWildcardArg: true,
    initialize: new LuaBuiltinFunction((_sf) => 0),
    iterate: new LuaBuiltinFunction((_sf, state: any, value: any) => {
      if (value === null || value === undefined) return state;
      return (state as number) + 1;
    }),
  };
  const config = makeConfig({ row_count: rowCount });
  const spec = getAggregateSpec("row_count", config)!;
  expect(spec.acceptsWildcardArg).toBe(true);

  // Both wildcard kinds pass validation -- no throw.
  expect(() =>
    validateAggregateWildcardArg(spec, { kind: "all" }, sf),
  ).not.toThrow();
  expect(() =>
    validateAggregateWildcardArg(spec, { kind: "source", source: "t" }, sf),
  ).not.toThrow();

  // And the aggregate runs end-to-end over whole rows, returning a row count
  // including the all-null record (PG strict-null filtering only kicks in
  // when called via `<src>.*`, which `executeAggregate` learns through the
  // `wildcardArg` parameter; here we exercise the no-wildcardArg path).
  const { value: result } = await executeAggregate(
    spec,
    jsToLuaValue([{ a: 1 }, { a: 2 }, {}]),
    null,
    [],
    undefined,
    new LuaEnv(),
    sf,
    evalExpression,
    config,
  );
  expect(result).toBe(3);
});

test("aggregate: custom acceptsWildcardArg flag survives LuaTable registration", () => {
  // The Lua-facing `aggregate.define` path stores the spec as a LuaTable.
  // `getAggregateSpec` must read `acceptsWildcardArg` from `rawGet` so the
  // flag round-trips through `config.setLuaValue({'aggregates', name}, spec)`.
  const config = new Config();
  config.set(
    "aggregates.row_table_agg",
    new LuaTable({
      name: "row_table_agg",
      acceptsWildcardArg: true,
      initialize: new LuaBuiltinFunction((_sf) => 0),
      iterate: new LuaBuiltinFunction(
        (_sf, state: any, _value: any) => (state as number) + 1,
      ),
    }),
  );
  const spec = getAggregateSpec("row_table_agg", config)!;
  expect(spec.acceptsWildcardArg).toBe(true);

  config.set(
    "aggregates.scalar_table_agg",
    new LuaTable({
      name: "scalar_table_agg",
      initialize: new LuaBuiltinFunction((_sf) => 0),
      iterate: new LuaBuiltinFunction(
        (_sf, state: any, _value: any) => (state as number) + 1,
      ),
    }),
  );
  const scalarSpec = getAggregateSpec("scalar_table_agg", config)!;
  expect(scalarSpec.acceptsWildcardArg).toBe(false);
});
