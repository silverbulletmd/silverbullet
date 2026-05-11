/**
 * ComputeFallbackEngine: the "claim anything at high cost" engine
 */
import type {
  BoundPredicate,
  EngineColumnStats,
  EngineInstrumentation,
  EnginePlanResult,
  EngineRowSet,
  EngineSpec,
  PlanContext,
  QueryEngine,
} from "./engine_contract.ts";
import type { QueryEngineCapability } from "./query_collection.ts";

/**
 * Synthetic relation id used by the compute fallback engine. The
 * dispatcher treats this as "matches any relation".
 */
export const COMPUTE_FALLBACK_RELATION = "<compute>";

/**
 * Stable engine id. Surfaces verbatim in EXPLAIN as
 * `Engine: compute-fallback`.
 */
export const COMPUTE_FALLBACK_ENGINE_ID = "compute-fallback";

/**
 * The engine's plan-time spec. Exposed as a constant so callers that
 * only need the advertisement (e.g. `eval.ts`'s
 * `executionCapabilities.engines` list) can reach it without
 * instantiating the engine.
 *
 * Capabilities use the unified `pred-*` vocabulary. The compute engine
 * advertises every predicate kind because it can evaluate any
 * expression the underlying Lua row evaluator can.
 */
export const COMPUTE_FALLBACK_ENGINE_CAPABILITY: QueryEngineCapability = {
  id: COMPUTE_FALLBACK_ENGINE_ID,
  name: "Compute fallback (row-by-row)",
  kind: "compute",
  capabilities: [
    "pred-eq",
    "pred-neq",
    "pred-lt",
    "pred-lte",
    "pred-gt",
    "pred-gte",
    "pred-in",
    "pred-is-nil",
    "pred-is-not-nil",
    "bool-and",
    "bool-or",
    "bool-not",
    "expr-literal",
    "expr-column-qualified",
    "expr-column-unqualified",
    "stage-where",
    "scan-materialized",
    "stats-row-count",
    "stats-ndv",
  ],
  baseCostWeight: 1.0,
  priority: 5,
};

// Pluggable evaluator: given a bound predicate and a row, return whether
// the row satisfies the predicate.
export type ComputeRowEvaluator = (
  pred: BoundPredicate,
  row: any,
) => Promise<boolean>;

interface ComputePlanHandle {
  pred: BoundPredicate;
  rows: any[];
  evaluate: ComputeRowEvaluator;
}

export class ComputeFallbackEngine implements QueryEngine {
  private constructor(
    private readonly rows: ReadonlyArray<any>,
    private readonly evaluate: ComputeRowEvaluator,
  ) {}

  // `rows` is the row source the engine will scan; `evaluate` is the
  // row-level WHERE evaluator. For consumers that only need the engine's
  // spec (without execution), pass `[]` and a stub evaluator.
  static create(
    rows: ReadonlyArray<any> = [],
    evaluate: ComputeRowEvaluator = async () => true,
  ): ComputeFallbackEngine {
    return new ComputeFallbackEngine(rows, evaluate);
  }

  spec(): EngineSpec {
    return {
      id: COMPUTE_FALLBACK_ENGINE_ID,
      name: COMPUTE_FALLBACK_ENGINE_CAPABILITY.name!,
      kind: "compute",
      relation: COMPUTE_FALLBACK_RELATION,
      columns: [],
      composites: ["and", "or", "not"],
      baseCostWeight: COMPUTE_FALLBACK_ENGINE_CAPABILITY.baseCostWeight ?? 1.0,
      priority: COMPUTE_FALLBACK_ENGINE_CAPABILITY.priority ?? 5,
      globalStatsKinds: ["row-count"],
      runtimeStatsKinds: ["rows-examined", "rows-returned", "time-ms"],
      metadata: {
        role: "fallback",
      },
    };
  }

  // Universal claim: the compute engine claims the entire predicate
  // with no residual. Cost is proportional to the number of rows it
  // will scan.  This is what makes it lose to cheaper specialised
  // engines under the planner's cost model, while still guaranteeing
  // totality.
  plan(pred: BoundPredicate, _ctx: PlanContext): EnginePlanResult | null {
    const handle: ComputePlanHandle = {
      pred,
      rows: [...this.rows],
      evaluate: this.evaluate,
    };
    return {
      claimed: pred,
      residual: null,
      // Linear in the row source size, weighted by the engine's
      // baseCostWeight (1.0). The planner's cost model picks cheaper
      // engines first; compute fallback is always available but
      // expensive.
      estimatedCost: this.spec().baseCostWeight * Math.max(1, this.rows.length),
      estimatedRows: this.rows.length,
      handle,
    };
  }

  async execute(
    plan: EnginePlanResult,
    instr: EngineInstrumentation,
  ): Promise<EngineRowSet> {
    const handle = plan.handle as ComputePlanHandle;
    const endTimer = instr.beginOperation("compute-evaluate");
    const out: any[] = [];
    try {
      for (const row of handle.rows) {
        instr.recordStat("rows-examined", 1);
        if (await handle.evaluate(handle.pred, row)) {
          out.push(row);
        }
      }
    } finally {
      endTimer();
    }
    instr.recordStat("rows-returned", out.length);
    return { kind: "rows", rows: out };
  }

  getColumnStats(_column: string): EngineColumnStats | undefined {
    // Compute fallback does not own any columns. Stats live with the
    // upstream engine that produced the rows.
    return undefined;
  }
}
