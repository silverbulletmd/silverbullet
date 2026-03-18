/**
 * Aggregate function definitions and execution for LIQ.
 *
 * Builtins implement ILuaFunction via plain objects rather than
 * LuaBuiltinFunction instances.  This avoids ES module TDZ issues:
 * `class` exports are not available during circular module init,
 * but `interface`/`type` imports are.
 */

import type { ILuaFunction, LuaStackFrame } from "./runtime.ts";
import {
  luaCall,
  type LuaEnv,
  LuaTable,
  luaTruthy,
  luaValueToJS,
  type LuaValue,
} from "./runtime.ts";
import { isSqlNull } from "./liq_null.ts";
import type { LuaExpression } from "./ast.ts";
import { buildItemEnv } from "./query_env.ts";
import { asyncMergeSort } from "./util.ts";
import type { Config } from "../config.ts";
import YAML from "js-yaml";

export interface AggregateSpec {
  name: string;
  description?: string;
  initialize: LuaValue; // ILuaFunction
  iterate: LuaValue; // ILuaFunction
  finish?: LuaValue; // ILuaFunction | undefined
}

// Helper to build an ILuaFunction from a plain function.  Equivalent to
// LuaBuiltinFunction but without referencing the class.
function aggFn(
  fn: (sf: LuaStackFrame, ...args: LuaValue[]) => LuaValue,
): ILuaFunction {
  return {
    call(sf: LuaStackFrame, ...args: LuaValue[]) {
      return fn(sf, ...args);
    },
    asString() {
      return "<builtin aggregate>";
    },
  };
}

// Welford's online algorithm (for variance and standard deviation)
interface WelfordState {
  n: number;
  mean: number;
  m2: number;
}

function welfordInit(): WelfordState {
  return { n: 0, mean: 0, m2: 0 };
}

function welfordIterate(state: WelfordState, value: any): WelfordState {
  if (value === null || value === undefined || isSqlNull(value)) return state;
  const x = value as number;
  state.n += 1;
  const delta = x - state.mean;
  state.mean += delta / state.n;
  const delta2 = x - state.mean;
  state.m2 += delta * delta2;
  return state;
}

// Built-in aggregate specs
const builtinAggregates: Record<string, AggregateSpec> = {
  // General purpose
  count: {
    name: "count",
    description:
      "Non-null row count for arguments; total row count without argument",
    initialize: aggFn((_sf) => 0),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      return (state as number) + 1;
    }),
  },
  sum: {
    name: "sum",
    description: "Arithmetic sum of all non-null input values",
    initialize: aggFn((_sf) => ({ result: 0, hasValue: false })),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      state.result += value as number;
      state.hasValue = true;
      return state;
    }),
    finish: aggFn((_sf, state: any) => {
      return state.hasValue ? state.result : null;
    }),
  },
  product: {
    name: "product",
    description: "Product of all non-null input values",
    initialize: aggFn((_sf) => ({ result: 1, hasValue: false })),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      state.result *= value as number;
      state.hasValue = true;
      return state;
    }),
    finish: aggFn((_sf, state: any) => {
      return state.hasValue ? state.result : null;
    }),
  },
  min: {
    name: "min",
    description: "Minimum value among non-null inputs",
    initialize: aggFn((_sf) => null),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      if (state === null || value < state) return value;
      return state;
    }),
  },
  max: {
    name: "max",
    description: "Maximum value among non-null inputs",
    initialize: aggFn((_sf) => null),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      if (state === null || value > state) return value;
      return state;
    }),
  },
  avg: {
    name: "avg",
    description: "Arithmetic mean of all non-null input values",
    initialize: aggFn((_sf) => ({ sum: 0, count: 0 })),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      state.sum += value as number;
      state.count += 1;
      return state;
    }),
    finish: aggFn((_sf, state: any) => {
      if (state.count === 0) return null;
      return state.sum / state.count;
    }),
  },
  // Collection and format
  array_agg: {
    name: "array_agg",
    description: "Input values concatenated into an array",
    initialize: aggFn((_sf) => new LuaTable()),
    iterate: aggFn((_sf, state: any, value: any) => {
      (state as LuaTable).rawSetArrayIndex(
        (state as LuaTable).length + 1,
        isSqlNull(value) ? null : value,
      );
      return state;
    }),
  },
  string_agg: {
    name: "string_agg",
    description: "Concatenated non-null values; delimited by ',' by default",
    initialize: aggFn((_sf, _ctx: any, sep: any) => {
      return { sep: sep ?? ",", parts: [] as string[] };
    }),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      state.parts.push(String(value));
      return state;
    }),
    finish: aggFn((_sf, state: any) => {
      return state.parts.join(state.sep);
    }),
  },
  yaml_agg: {
    name: "yaml_agg",
    description: "Input values aggregated into a YAML string",
    initialize: aggFn((_sf) => [] as any[]),
    iterate: aggFn((sf, state: any, value: any) => {
      if (value instanceof LuaTable) {
        state.push(luaValueToJS(value, sf));
      } else {
        state.push(value);
      }
      return state;
    }),
    finish: aggFn((_sf, state: any) => {
      return YAML.dump(state, { quotingType: '"', noCompatMode: true });
    }),
  },
  json_agg: {
    name: "json_agg",
    description: "Input values aggregated into a JSON string",
    initialize: aggFn((_sf) => [] as any[]),
    iterate: aggFn((sf, state: any, value: any) => {
      if (isSqlNull(value)) {
        state.push(null);
      } else if (value instanceof LuaTable) {
        state.push(luaValueToJS(value, sf));
      } else {
        state.push(value);
      }
      return state;
    }),
    finish: aggFn((_sf, state: any) => {
      return JSON.stringify(state);
    }),
  },
  // Bitwise and boolean
  bit_and: {
    name: "bit_and",
    description: "Bitwise AND of all non-null input values",
    initialize: aggFn((_sf) => ({ result: ~0, hasValue: false })),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      state.result &= value as number;
      state.hasValue = true;
      return state;
    }),
    finish: aggFn((_sf, state: any) => {
      return state.hasValue ? state.result : null;
    }),
  },
  bit_or: {
    name: "bit_or",
    description: "Bitwise OR of all non-null input values",
    initialize: aggFn((_sf) => ({ result: 0, hasValue: false })),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      state.result |= value as number;
      state.hasValue = true;
      return state;
    }),
    finish: aggFn((_sf, state: any) => {
      return state.hasValue ? state.result : null;
    }),
  },
  bit_xor: {
    name: "bit_xor",
    description: "Bitwise exclusive OR of all non-null input values",
    initialize: aggFn((_sf) => ({ result: 0, hasValue: false })),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      state.result ^= value as number;
      state.hasValue = true;
      return state;
    }),
    finish: aggFn((_sf, state: any) => {
      return state.hasValue ? state.result : null;
    }),
  },
  bool_and: {
    name: "bool_and",
    description: "True if all non-null inputs are true, otherwise false",
    initialize: aggFn((_sf) => ({ result: true, hasValue: false })),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      state.result = state.result && !!value;
      state.hasValue = true;
      return state;
    }),
    finish: aggFn((_sf, state: any) => {
      return state.hasValue ? state.result : null;
    }),
  },
  bool_or: {
    name: "bool_or",
    description: "True if at least one non-null input is true, otherwise false",
    initialize: aggFn((_sf) => ({ result: false, hasValue: false })),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      state.result = state.result || !!value;
      state.hasValue = true;
      return state;
    }),
    finish: aggFn((_sf, state: any) => {
      return state.hasValue ? state.result : null;
    }),
  },
  // Statistical
  stddev_pop: {
    name: "stddev_pop",
    description: "Population standard deviation of non-null inputs",
    initialize: aggFn((_sf) => welfordInit()),
    iterate: aggFn((_sf, state: any, value: any) =>
      welfordIterate(state, value),
    ),
    finish: aggFn((_sf, state: any) => {
      if (state.n === 0) return null;
      return Math.sqrt(state.m2 / state.n);
    }),
  },
  stddev_samp: {
    name: "stddev_samp",
    description: "Sample standard deviation of non-null inputs",
    initialize: aggFn((_sf) => welfordInit()),
    iterate: aggFn((_sf, state: any, value: any) =>
      welfordIterate(state, value),
    ),
    finish: aggFn((_sf, state: any) => {
      if (state.n < 2) return null;
      return Math.sqrt(state.m2 / (state.n - 1));
    }),
  },
  var_pop: {
    name: "var_pop",
    description:
      "Population variance (square of population standard deviation)",
    initialize: aggFn((_sf) => welfordInit()),
    iterate: aggFn((_sf, state: any, value: any) =>
      welfordIterate(state, value),
    ),
    finish: aggFn((_sf, state: any) => {
      if (state.n === 0) return null;
      return state.m2 / state.n;
    }),
  },
  var_samp: {
    name: "var_samp",
    description: "Sample variance (square of sample standard deviation)",
    initialize: aggFn((_sf) => welfordInit()),
    iterate: aggFn((_sf, state: any, value: any) =>
      welfordIterate(state, value),
    ),
    finish: aggFn((_sf, state: any) => {
      if (state.n < 2) return null;
      return state.m2 / (state.n - 1);
    }),
  },
};

const noCtx = {};

function buildAggCtx(name: string, config: Config): LuaTable {
  const ctx = new LuaTable();
  void ctx.rawSet("name", name);
  void ctx.rawSet("config", config.get(`aggregateConfig.${name}`, {}));
  return ctx;
}

/**
 * Resolve name through config following alias chains (cycles detected)
 */
export function getAggregateSpec(
  name: string,
  config?: Config,
): AggregateSpec | null {
  const visited = new Set<string>();
  let current = name;

  while (config) {
    if (visited.has(current)) return null; // cycle
    visited.add(current);

    const spec: any = config.get(`aggregates.${current}`, null);
    if (!spec) break;

    // Check for alias redirect
    const alias = spec instanceof LuaTable ? spec.rawGet("alias") : spec.alias;
    if (typeof alias === "string") {
      current = alias;
      continue;
    }

    // Full definition in config
    let candidate: AggregateSpec | null = null;
    if (spec instanceof LuaTable) {
      const init = spec.rawGet("initialize");
      const iter = spec.rawGet("iterate");
      if (init && iter) {
        candidate = {
          name: spec.rawGet("name") ?? current,
          description: spec.rawGet("description"),
          initialize: init,
          iterate: iter,
          finish: spec.rawGet("finish"),
        };
      }
    } else if (spec.initialize && spec.iterate) {
      candidate = spec as AggregateSpec;
    }
    if (candidate) return candidate;
    break;
  }

  return builtinAggregates[current] ?? null;
}

/**
 * Returns info about all built-in aggregates
 */
export function getBuiltinAggregateEntries(): {
  name: string;
  description: string;
  hasFinish: boolean;
}[] {
  return Object.values(builtinAggregates).map((spec) => ({
    name: spec.name,
    description: spec.description ?? "",
    hasFinish: !!spec.finish,
  }));
}

/**
 * Execute an aggregate function over a group of items.
 */
export async function executeAggregate(
  spec: AggregateSpec,
  items: LuaTable,
  valueExpr: LuaExpression | null,
  extraArgExprs: LuaExpression[],
  objectVariable: string | undefined,
  env: LuaEnv,
  sf: LuaStackFrame,
  evalExprFn: (
    e: LuaExpression,
    env: LuaEnv,
    sf: LuaStackFrame,
  ) => Promise<LuaValue> | LuaValue,
  config: Config,
  filterExpr?: LuaExpression,
  orderBy?: import("./ast.ts").LuaOrderBy[],
): Promise<LuaValue> {
  const ctx = buildAggCtx(spec.name, config);

  // Evaluate extra args once (before the loop)
  const extraArgs: LuaValue[] = [];
  for (const argExpr of extraArgExprs) {
    extraArgs.push(await evalExprFn(argExpr, env, sf));
  }

  // Initialize
  let state = await luaCall(spec.initialize, [ctx, ...extraArgs], noCtx, sf);

  // Iterate
  const filteredItems: LuaValue[] = [];
  const len = items.length;
  for (let i = 1; i <= len; i++) {
    const item = items.rawGet(i);

    // Filter
    if (filterExpr) {
      const filterEnv = buildItemEnv(objectVariable, item, env, sf);
      const filterResult = await evalExprFn(filterExpr, filterEnv, sf);
      if (!luaTruthy(filterResult)) {
        continue;
      }
    }
    filteredItems.push(item);
  }

  // Intra-aggregate ordering
  if (orderBy && orderBy.length > 0) {
    await asyncMergeSort(filteredItems, async (a: any, b: any) => {
      for (const ob of orderBy) {
        const envA = buildItemEnv(objectVariable, a, env, sf);
        const envB = buildItemEnv(objectVariable, b, env, sf);
        const valA = await evalExprFn(ob.expression, envA, sf);
        const valB = await evalExprFn(ob.expression, envB, sf);
        const aNull = valA === null || valA === undefined;
        const bNull = valB === null || valB === undefined;
        if (aNull && bNull) continue;
        if (aNull) return ob.nulls === "first" ? -1 : 1;
        if (bNull) return ob.nulls === "first" ? 1 : -1;
        let cmp = 0;
        if (valA < valB) cmp = -1;
        else if (valA > valB) cmp = 1;
        if (cmp !== 0) {
          return ob.direction === "desc" ? -cmp : cmp;
        }
      }
      return 0;
    });
  }

  // Iterate
  for (const item of filteredItems) {
    let value: LuaValue;
    if (valueExpr === null) {
      value = item;
    } else {
      const itemEnv = buildItemEnv(objectVariable, item, env, sf);
      value = await evalExprFn(valueExpr, itemEnv, sf);
    }
    state = await luaCall(
      spec.iterate,
      [state, value, ctx, ...extraArgs],
      noCtx,
      sf,
    );
  }

  // Finish
  if (spec.finish) {
    state = await luaCall(spec.finish, [state, ctx, ...extraArgs], noCtx, sf);
  }

  return state;
}
