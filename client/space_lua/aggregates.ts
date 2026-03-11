/**
 * Aggregate function definitions and execution for LIQ.
 *
 * Built-in aggregates (sum, count, min, max, avg, array_agg) are
 * implemented in TypeScript for speed.  Users can override any builtin
 * via `aggregate.define` or `aggregate.update`.
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
  type LuaValue,
} from "./runtime.ts";
import type { LuaExpression } from "./ast.ts";
import { buildItemEnv } from "./query_env.ts";
import { asyncMergeSort } from "./util.ts";
import type { Config } from "../config.ts";

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

// Built-in aggregate specs
const builtinAggregates: Record<string, AggregateSpec> = {
  sum: {
    name: "sum",
    description: "Sum of numeric values",
    initialize: aggFn((_sf) => 0),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined) return state;
      return (state as number) + (value as number);
    }),
  },
  count: {
    name: "count",
    description: "Count of values; count() with no argument counts all rows",
    initialize: aggFn((_sf) => 0),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined) return state;
      return (state as number) + 1;
    }),
  },
  min: {
    name: "min",
    description: "Minimum value",
    initialize: aggFn((_sf) => null),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined) return state;
      if (state === null || value < state) return value;
      return state;
    }),
  },
  max: {
    name: "max",
    description: "Maximum value",
    initialize: aggFn((_sf) => null),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined) return state;
      if (state === null || value > state) return value;
      return state;
    }),
  },
  avg: {
    name: "avg",
    description: "Average of numeric values",
    initialize: aggFn((_sf) => ({ sum: 0, count: 0 })),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined) return state;
      state.sum += value as number;
      state.count += 1;
      return state;
    }),
    finish: aggFn((_sf, state: any) => {
      if (state.count === 0) return null;
      return state.sum / state.count;
    }),
  },
  array_agg: {
    name: "array_agg",
    description: "Collect values into an array",
    initialize: aggFn((_sf) => new LuaTable()),
    iterate: aggFn((_sf, state: any, value: any) => {
      (state as LuaTable).rawSetArrayIndex(
        (state as LuaTable).length + 1,
        value,
      );
      return state;
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

export function getAggregateSpec(
  name: string,
  config?: Config,
): AggregateSpec | null {
  if (config) {
    const spec: any = config.get(`aggregates.${name}`, null);
    if (spec) {
      let candidate: AggregateSpec | null = null;
      if (spec instanceof LuaTable) {
        const init = spec.rawGet("initialize");
        const iter = spec.rawGet("iterate");
        if (init && iter) {
          candidate = {
            name: spec.rawGet("name") ?? name,
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
    }
  }
  return builtinAggregates[name] ?? null;
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
