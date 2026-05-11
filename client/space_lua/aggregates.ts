/**
 * Aggregate function definitions and execution for SLIQ.
 *
 * Builtins implement ILuaFunction via plain objects rather than
 * LuaBuiltinFunction instances.  This avoids ES module TDZ issues:
 * `class` exports are not available during circular module init,
 * but `interface`/`type` imports are.
 */

import type { ILuaFunction, LuaStackFrame } from "./runtime.ts";
import {
  LuaRuntimeError,
  luaCall,
  type LuaEnv,
  LuaTable,
  luaTruthy,
  luaValueToJS,
  type LuaValue,
} from "./runtime.ts";
import { isSqlNull } from "./sliq_null.ts";
import type { LuaExpression, LuaOrderBy } from "./ast.ts";
import { buildItemEnv } from "./query_env.ts";
import { asyncMergeSort } from "./util.ts";
import { untagNumber } from "./numeric.ts";
import type { Config } from "../config.ts";
import YAML from "js-yaml";

// Coerce a Lua aggregate input to a plain JS number.
function numericValue(value: any): number | null {
  if (value === null || value === undefined || isSqlNull(value)) return null;
  return untagNumber(value);
}

// Stable comparison used by `min`/`max` (including their wildcard forms)
function compareLuaValues(a: any, b: any): number {
  const aNull = a === null || a === undefined || isSqlNull(a);
  const bNull = b === null || b === undefined || isSqlNull(b);
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (a instanceof LuaTable && b instanceof LuaTable) {
    return compareLuaRecords(a, b);
  }
  const ua = untagNumber(a);
  const ub = untagNumber(b);
  if (typeof ua === "number" && typeof ub === "number") {
    return ua < ub ? -1 : ua > ub ? 1 : 0;
  }
  if (typeof ua === "string" && typeof ub === "string") {
    return ua < ub ? -1 : ua > ub ? 1 : 0;
  }
  const sa = String(ua);
  const sb = String(ub);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Lex-compare two records column-by-column. Walks `a`'s keys first (preserving
 * insertion order), then any keys in `b` not present in `a`. Missing keys in
 * the other side compare as null. Posgres-aligned for record `min` / `max`.
 */
function compareLuaRecords(a: LuaTable, b: LuaTable): number {
  const seen = new Set<any>();
  const ordered: any[] = [];
  for (const k of a.keys()) {
    if (!seen.has(k)) {
      seen.add(k);
      ordered.push(k);
    }
  }
  for (const k of b.keys()) {
    if (!seen.has(k)) {
      seen.add(k);
      ordered.push(k);
    }
  }
  for (const k of ordered) {
    const c = compareLuaValues(a.rawGet(k), b.rawGet(k));
    if (c !== 0) return c;
  }
  return 0;
}

/**
 * Postgres-aligned record-null check. A composite/record value is null iff
 * every column is null. Empty records (no columns) are also treated as null
 * (no non-null columns means nothing to be non-null about).
 *
 * Drives strict null semantics for `<agg>(t.*)` calls: rows whose
 * `t`-projection is all-null are skipped, just like in Postgres.
 */
export function isRecordNull(v: any): boolean {
  if (!(v instanceof LuaTable)) return false;
  const keys = v.keys();
  if (keys.length === 0) return true;
  for (const k of keys) {
    const val = v.rawGet(k);
    if (val !== null && val !== undefined && !isSqlNull(val)) return false;
  }
  return true;
}

export interface AggregateSpec {
  name: string;
  description?: string;
  initialize: LuaValue; // ILuaFunction
  iterate: LuaValue; // ILuaFunction
  finish?: LuaValue; // ILuaFunction | undefined
  // Whether the aggregate accepts a wildcard argument (`*` or `<source>.*`)
  acceptsWildcardArg?: boolean;
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
  const x = numericValue(value);
  if (x === null) return state;
  state.n += 1;
  const delta = x - state.mean;
  state.mean += delta / state.n;
  const delta2 = x - state.mean;
  state.m2 += delta * delta2;
  return state;
}

interface CovarState extends WelfordState {
  meanY: number;
  m2y: number;
  c: number; // co-moment
}

function covarInit(): CovarState {
  return { n: 0, mean: 0, m2: 0, meanY: 0, m2y: 0, c: 0 };
}

function covarIterate(state: CovarState, x: any, y: any): CovarState {
  const xn = numericValue(x);
  const yn = numericValue(y);
  if (xn === null || yn === null) return state;
  state.n += 1;
  const dx = xn - state.mean;
  state.mean += dx / state.n;
  const dy = yn - state.meanY;
  state.meanY += dy / state.n;
  const dx2 = xn - state.mean;
  const dy2 = yn - state.meanY;
  state.c += dx * dy2;
  state.m2 += dx * dx2;
  state.m2y += dy * dy2;
  return state;
}

// Quantile interpolation methods
type QuantileMethod =
  | "linear" // percentile_cont
  | "lower" // percentile_disc
  | "higher"
  | "nearest"
  | "midpoint";

interface QuantileState {
  values: number[];
  q: number;
  method: QuantileMethod;
}

// Default method based on aggregate invocation name
const quantileNameDefaults: Record<string, QuantileMethod> = {
  percentile_cont: "linear",
  percentile_disc: "lower",
};

function quantileFinish(state: QuantileState): number | null {
  const { values, q, method } = state;
  if (values.length === 0) return null;
  const n = values.length;
  if (n === 1) return values[0];
  const idx = q * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  switch (method) {
    case "lower":
      return values[lo];
    case "higher":
      return values[hi];
    case "nearest":
      return idx - lo <= 0.5 ? values[lo] : values[hi];
    case "midpoint":
      return (values[lo] + values[hi]) / 2;
    case "linear": {
      if (lo === hi) return values[lo];
      const frac = idx - lo;
      return values[lo] + frac * (values[hi] - values[lo]);
    }
    default:
      throw new Error(`quantile: unsupported interpolation method '${method}'`);
  }
}

// Shared spec — branching on `ctx.name` for the default method
function makeQuantileSpec(name: string, description: string): AggregateSpec {
  return {
    name,
    description,
    initialize: aggFn((_sf, ctx: any, q: any, method: any) => {
      const qVal = q ?? 0.5;
      if (typeof qVal !== "number" || qVal < 0 || qVal > 1) {
        throw new Error(`${name}: quantile must be between 0 and 1`);
      }
      const ctxName = ctx instanceof LuaTable ? ctx.rawGet("name") : name;
      const m = (method ??
        quantileNameDefaults[ctxName] ??
        "linear") as QuantileMethod;
      return { values: [] as number[], q: qVal, method: m } as QuantileState;
    }),
    iterate: aggFn((_sf, state: any, value: any) => {
      const x = numericValue(value);
      if (x === null) return state;
      state.values.push(x);
      return state;
    }),
    finish: aggFn((_sf, state: any) => quantileFinish(state as QuantileState)),
  };
}

// Built-in aggregate specs
const builtinAggregates: Record<string, AggregateSpec> = {
  // General purpose
  count: {
    name: "count",
    description:
      "Non-null row count for arguments; total row count without argument",
    acceptsWildcardArg: true,
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
      const x = numericValue(value);
      if (x === null) return state;
      state.result += x;
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
      const x = numericValue(value);
      if (x === null) return state;
      state.result *= x;
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
    acceptsWildcardArg: true,
    initialize: aggFn((_sf) => null),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      if (state === null) return value;
      return compareLuaValues(value, state) < 0 ? value : state;
    }),
  },
  max: {
    name: "max",
    description: "Maximum value among non-null inputs",
    acceptsWildcardArg: true,
    initialize: aggFn((_sf) => null),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      if (state === null) return value;
      return compareLuaValues(value, state) > 0 ? value : state;
    }),
  },
  avg: {
    name: "avg",
    description: "Arithmetic mean of all non-null input values",
    initialize: aggFn((_sf) => ({ sum: 0, count: 0 })),
    iterate: aggFn((_sf, state: any, value: any) => {
      const x = numericValue(value);
      if (x === null) return state;
      state.sum += x;
      state.count += 1;
      return state;
    }),
    finish: aggFn((_sf, state: any) => {
      if (state.count === 0) return null;
      return state.sum / state.count;
    }),
  },
  first: {
    name: "first",
    description: "First non-null input value (iteration order)",
    acceptsWildcardArg: true,
    initialize: aggFn((_sf) => ({ value: null, found: false })),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (state.found) return state;
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      state.value = value;
      state.found = true;
      return state;
    }),
    finish: aggFn((_sf, state: any) => state.value),
  },
  last: {
    name: "last",
    description: "Last non-null input value (iteration order)",
    acceptsWildcardArg: true,
    initialize: aggFn((_sf) => null),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      return value;
    }),
  },
  // Collection and format
  array_agg: {
    name: "array_agg",
    description: "Input values concatenated into an array",
    acceptsWildcardArg: true,
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
    description:
      "Concatenated non-null values; argument: delimiter (default: ',')",
    initialize: aggFn((_sf, _ctx: any, sep: any) => {
      return { sep: sep ?? ",", parts: [] as string[] };
    }),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      state.parts.push(String(untagNumber(value)));
      return state;
    }),
    finish: aggFn((_sf, state: any) => {
      return state.parts.join(state.sep);
    }),
  },
  yaml_agg: {
    name: "yaml_agg",
    description: "Input values aggregated into a YAML string",
    acceptsWildcardArg: true,
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
      return YAML.dump(state, { quotingType: '"', noCompatMode: true });
    }),
  },
  json_agg: {
    name: "json_agg",
    description: "Input values aggregated into a JSON string",
    acceptsWildcardArg: true,
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
      const x = numericValue(value);
      if (x === null) return state;
      state.result &= x;
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
      const x = numericValue(value);
      if (x === null) return state;
      state.result |= x;
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
      const x = numericValue(value);
      if (x === null) return state;
      state.result ^= x;
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
  covar_pop: {
    name: "covar_pop",
    description: "Population covariance of non-null input pairs",
    initialize: aggFn((_sf) => covarInit()),
    iterate: aggFn((_sf, state: any, y: any, _ctx: any, x: any) =>
      covarIterate(state, x, y),
    ),
    finish: aggFn((_sf, state: any) => {
      if (state.n === 0) return null;
      return state.c / state.n;
    }),
  },
  covar_samp: {
    name: "covar_samp",
    description: "Sample covariance of non-null input pairs",
    initialize: aggFn((_sf) => covarInit()),
    iterate: aggFn((_sf, state: any, y: any, _ctx: any, x: any) =>
      covarIterate(state, x, y),
    ),
    finish: aggFn((_sf, state: any) => {
      if (state.n < 2) return null;
      return state.c / (state.n - 1);
    }),
  },
  corr: {
    name: "corr",
    description: "Correlation coefficient of non-null input pairs",
    initialize: aggFn((_sf) => covarInit()),
    iterate: aggFn((_sf, state: any, y: any, _ctx: any, x: any) =>
      covarIterate(state, x, y),
    ),
    finish: aggFn((_sf, state: any) => {
      if (state.n < 2) return null;
      const denom = Math.sqrt(state.m2 * state.m2y);
      if (denom === 0) return null;
      return state.c / denom;
    }),
  },
  mode: {
    name: "mode",
    description: "Most frequent non-null input value",
    initialize: aggFn((_sf) => ({
      freq: new Map<LuaValue, number>(),
      best: null as LuaValue,
      bestCount: 0,
    })),
    iterate: aggFn((_sf, state: any, value: any) => {
      if (value === null || value === undefined || isSqlNull(value))
        return state;
      // Untag so two `LuaTaggedFloat` instances of the same number key the
      // map identically (otherwise `Map` would treat them as distinct).
      const key = untagNumber(value);
      const c = (state.freq.get(key) ?? 0) + 1;
      state.freq.set(key, c);
      if (c > state.bestCount) {
        state.bestCount = c;
        state.best = key;
      }
      return state;
    }),
    finish: aggFn((_sf, state: any) => {
      return state.bestCount > 0 ? state.best : null;
    }),
  },
  // Quantile and percentile
  quantile: makeQuantileSpec(
    "quantile",
    "Quantile of ordered set of non-null inputs; arguments: value, quantile (0-1), interpolation ('lower', 'higher', 'nearest', 'midpoint' and default: 'linear')",
  ),
  percentile_cont: makeQuantileSpec(
    "percentile_cont",
    "Continuous percentile (linear interpolation) on ordered set of non-null inputs; arguments: value, fraction (0-1)",
  ),
  percentile_disc: makeQuantileSpec(
    "percentile_disc",
    "Discrete percentile (nearest lower value) on ordered set of non-null inputs; arguments: value, fraction (0-1)",
  ),
  median: {
    name: "median",
    description: "Median of non-null inputs (continuous percentile at 0.5)",
    initialize: aggFn((_sf) => ({
      values: [] as number[],
      q: 0.5,
      method: "linear" as QuantileMethod,
    })),
    iterate: aggFn((_sf, state: any, value: any) => {
      const x = numericValue(value);
      if (x === null) return state;
      state.values.push(x);
      return state;
    }),
    finish: aggFn((_sf, state: any) => quantileFinish(state as QuantileState)),
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
          acceptsWildcardArg: !!spec.rawGet("acceptsWildcardArg"),
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
 * Reject `<agg>(*)` / `<agg>(t.*)` for aggregates that do not opt into
 * `acceptsWildcardArg`. Mirrors Postgres, where `sum(t.*)`, `avg(t.*)`,
 * `string_agg(t.*, sep)`, etc. raise "function does not exist". In SLIQ the
 * value would otherwise be coerced to garbage by the iterator (`0 + {}` etc.).
 *
 * `count(*)` is not routed here - it is handled by the parser as a
 * `wildcardArg` of kind "all" and consumed in the same place as `<src>.*`.
 *
 * Aggregates that do accept wildcards (`count`, `first`, `last`, `array_agg`,
 * `yaml_agg`, `json_agg`) opt in via the spec.
 */
export function validateAggregateWildcardArg(
  spec: AggregateSpec,
  wildcardArg: { kind: "all" } | { kind: "source"; source: string } | undefined,
  sf: LuaStackFrame,
): void {
  if (!wildcardArg) return;
  if (spec.acceptsWildcardArg) return;
  const arg = wildcardArg.kind === "all" ? "*" : `${wildcardArg.source}.*`;
  throw new LuaRuntimeError(
    `aggregate '${spec.name}' does not accept a wildcard argument '${arg}'; ` +
      `pass a column expression like ${spec.name}(<source>.<column>)`,
    sf,
  );
}

/**
 * Result of executing an aggregate, including the computed value
 * and optional instrumentation counters.
 */
export type AggregateResult = {
  value: LuaValue;
  rowsFiltered?: number;
};

/**
 * Execute an aggregate function over a group of items.
 *
 * Returns an `AggregateResult` when `instrumented` is true, otherwise
 * returns the raw `LuaValue` for backward compatibility.
 *
 * `wildcardArg` carries through the call's wildcard form (`*` or `<src>.*`)
 * so we can apply Postgres' strict null-record semantics for `<agg>(t.*)`:
 * rows whose `t`-projection is all-null are treated as null and skipped by
 * the iterator. `count(*)` (kind "all") preserves Postgres behaviour and
 * counts every row regardless of contents.
 */
export type WildcardArg = { kind: "all" } | { kind: "source"; source: string };

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
  orderBy?: LuaOrderBy[],
  wildcardArg?: WildcardArg,
): Promise<AggregateResult> {
  const ctx = buildAggCtx(spec.name, config);

  // Evaluate extra args using the first item's env so that references
  // to the object variable (e.g. `data.x`) resolve correctly.
  // These are used for initialize and finish; iterate re-evaluates per-item.
  const extraArgs: LuaValue[] = [];
  if (extraArgExprs.length > 0) {
    const firstItem = items.length > 0 ? items.rawGet(1) : undefined;
    const firstEnv =
      firstItem !== undefined
        ? buildItemEnv(objectVariable, firstItem, env, sf)
        : env;
    for (const argExpr of extraArgExprs) {
      extraArgs.push(await evalExprFn(argExpr, firstEnv, sf));
    }
  }

  // Initialize
  let state = await luaCall(spec.initialize, [ctx, ...extraArgs], noCtx, sf);

  // Collect filtered items
  const filteredItems: LuaValue[] = [];
  let rowsFiltered = 0;
  const len = items.length;
  for (let i = 1; i <= len; i++) {
    const item = items.rawGet(i);

    // Filter
    if (filterExpr) {
      const filterEnv = buildItemEnv(objectVariable, item, env, sf);
      const filterResult = await evalExprFn(filterExpr, filterEnv, sf);
      if (!luaTruthy(filterResult)) {
        rowsFiltered++;
        continue;
      }
    }
    filteredItems.push(item);
  }

  // Intra-aggregate ordering: sorts items before iteration.
  // This is required for ordered-set aggregates (quantile, percentile_cont,
  // percentile_disc) which expect values in a specific order. The user
  // must provide `order by` for these aggregates to produce correct results.
  if (orderBy && orderBy.length > 0) {
    // Wildcards in aggregate 'order by' have no stable meaning — rejected
    // early to avoid unstable output.
    type ConcreteOrderBy = LuaOrderBy & { expression: LuaExpression };
    const concreteOrderBy: ConcreteOrderBy[] = orderBy.map((ob) => {
      if (!ob.expression) {
        throw new LuaRuntimeError(
          "'order by' in aggregate with wildcard sort keys is not supported",
          sf,
        );
      }
      return ob as ConcreteOrderBy;
    });
    await asyncMergeSort(filteredItems, async (a: any, b: any) => {
      for (const ob of concreteOrderBy) {
        const envA = buildItemEnv(objectVariable, a, env, sf);
        const envB = buildItemEnv(objectVariable, b, env, sf);
        const valA = await evalExprFn(ob.expression, envA, sf);
        const valB = await evalExprFn(ob.expression, envB, sf);
        const aNull = valA === null || valA === undefined || isSqlNull(valA);
        const bNull = valB === null || valB === undefined || isSqlNull(valB);
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

  // Strict null-record semantics for `<agg>(<src>.*)`: rows whose `<src>`
  // projection is an all-null record are treated as null. `count(*)` (kind
  // "all") preserves Postgres behaviour and counts every row regardless.
  const recordNullSemantics = wildcardArg?.kind === "source";

  // Iterate
  for (const item of filteredItems) {
    const itemEnv = buildItemEnv(objectVariable, item, env, sf);
    let value: LuaValue;
    if (valueExpr === null) {
      value = item;
    } else {
      value = await evalExprFn(valueExpr, itemEnv, sf);
    }
    if (recordNullSemantics && isRecordNull(value)) {
      value = null;
    }
    // Evaluate extra args per-item so they can reference item fields
    const iterExtraArgs: LuaValue[] = [];
    for (const argExpr of extraArgExprs) {
      iterExtraArgs.push(await evalExprFn(argExpr, itemEnv, sf));
    }
    state = await luaCall(
      spec.iterate,
      [state, value, ctx, ...iterExtraArgs],
      noCtx,
      sf,
    );
  }

  // Finish
  if (spec.finish) {
    state = await luaCall(spec.finish, [state, ctx, ...extraArgs], noCtx, sf);
  }

  return {
    value: state,
    rowsFiltered: filterExpr ? rowsFiltered : undefined,
  };
}
