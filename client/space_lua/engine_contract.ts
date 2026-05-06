// Query engine contract: capabilities, bound predicates, plan/execute, stats.

import type { LuaExpression } from "./ast.ts";
import type { MCVList } from "./mcv.ts";

export type EnginePredicateKind =
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "in"
  | "not-in"
  | "is-nil"
  | "is-not-nil"
  | "string-prefix"
  | "string-suffix"
  | "string-contains"
  | "regex"
  | "range";

export type EngineCompositeKind = "and" | "or" | "not";

export type EngineExpressionKind =
  | "literal"
  | "column-qualified"
  | "column-unqualified"
  | "function-call"
  | "arithmetic";

export type EngineStatsKind =
  | "row-count"
  | "ndv"
  | "mcv"
  | "histogram"
  | "selectivity-hint";

// Instrumentation keys; EXPLAIN may relabel (e.g. time-ms).
export type EngineRuntimeStatKind =
  | "rows-examined"
  | "rows-returned"
  | "time-ms"
  | "cache-hits"
  | "cache-misses"
  | "bitmap-population-ms"
  | "bitmap-intersection-ms"
  | "io-bytes-read";

export type EngineKind = "index" | "overlay" | "scan" | "compute" | "adapter";

export type EngineColumnSpec = {
  name: string;
  predicateKinds: EnginePredicateKind[];
  valueKinds: EngineExpressionKind[];
  statsKinds: EngineStatsKind[];
  costOverrides?: Partial<Record<EnginePredicateKind, number>>;
};

export type EngineSpec = {
  id: string;
  name: string;
  kind: EngineKind;
  relation: string;
  columns: EngineColumnSpec[];
  composites: EngineCompositeKind[];
  baseCostWeight: number;
  priority: number;
  globalStatsKinds: EngineStatsKind[];
  runtimeStatsKinds: EngineRuntimeStatKind[];
  metadata?: Record<string, string | number | boolean>;
};

export type BoundValue =
  | { kind: "literal-string"; value: string }
  | { kind: "literal-number"; value: number }
  | { kind: "literal-boolean"; value: boolean }
  | { kind: "literal-nil" }
  | { kind: "column"; relation: string; column: string }
  | { kind: "opaque"; expr: LuaExpression };

export type BoundLeafPredicate = {
  kind: "leaf";
  relation: string;
  column: string;
  op: EnginePredicateKind;
  value?: BoundValue;
  values?: BoundValue[];
  expr: LuaExpression;
};

export type BoundCompositePredicate = {
  kind: "composite";
  op: EngineCompositeKind;
  children: BoundPredicate[];
  expr: LuaExpression;
};

export type BoundOpaquePredicate = {
  kind: "opaque";
  relation: string;
  expr: LuaExpression;
};

export type BoundPredicate =
  | BoundLeafPredicate
  | BoundCompositePredicate
  | BoundOpaquePredicate;

export type PlanContext = {
  phase: "pre-source" | "source-leaf" | "post-join" | "residual";
  upstreamRowsEstimate?: number;
  smallSetThreshold: number;
  peerEngines: ReadonlyArray<EngineSpec>;
};

export type EnginePlanHandle = unknown;

export type EnginePlanResult = {
  claimed: BoundPredicate;
  residual: BoundPredicate | null;
  estimatedCost: number;
  estimatedRows: number;
  handle: EnginePlanHandle;
};

export type EngineRowSet =
  | { kind: "ids"; relation: string; ids: Set<number> }
  | { kind: "rows"; rows: any[] }
  | { kind: "declined"; reason: string };

export type EngineInstrumentation = {
  recordStat(kind: EngineRuntimeStatKind, value: number): void;
  beginOperation(label: string): () => void;
  recordEvent(label: string, detail?: Record<string, unknown>): void;
};

export type EngineColumnStats = {
  rowCount?: number;
  ndv?: number;
  mcv?: MCVList;
  metadata?: Record<string, unknown>;
};

export interface QueryEngine {
  spec(): EngineSpec;
  plan(pred: BoundPredicate, ctx: PlanContext): EnginePlanResult | null;
  execute(
    plan: EnginePlanResult,
    instr: EngineInstrumentation,
  ): Promise<EngineRowSet>;
  getColumnStats(column: string): EngineColumnStats | undefined;
  resolveIds?(
    ids: Iterable<number>,
    instr: EngineInstrumentation,
  ): Promise<any[]>;
}
