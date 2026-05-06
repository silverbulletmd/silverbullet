/**
 * ArrayScanEngine: pure scan engine that yields rows from a
 * materialised array, one by one, with no predicate pushdown.
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

export const ARRAY_SCAN_ENGINE_ID = "array-scan";

export const ARRAY_SCAN_ENGINE_CAPABILITY: QueryEngineCapability = {
  id: ARRAY_SCAN_ENGINE_ID,
  name: "Array scan (materialised)",
  kind: "scan",
  capabilities: ["scan-materialized", "stats-row-count", "stats-ndv"],
  baseCostWeight: 1.0,
  priority: 10,
};

interface ArrayScanPlanHandle {
  rows: any[];
}

export class ArrayScanEngine implements QueryEngine {
  private constructor(
    private readonly rows: ReadonlyArray<any>,
    private readonly relation: string,
  ) {}

  static create(
    rows: ReadonlyArray<any> = [],
    relation = "<scan>",
  ): ArrayScanEngine {
    return new ArrayScanEngine(rows, relation);
  }

  spec(): EngineSpec {
    return {
      id: ARRAY_SCAN_ENGINE_ID,
      name: ARRAY_SCAN_ENGINE_CAPABILITY.name!,
      kind: "scan",
      relation: this.relation,
      columns: [],
      composites: [],
      baseCostWeight: ARRAY_SCAN_ENGINE_CAPABILITY.baseCostWeight ?? 1.0,
      priority: ARRAY_SCAN_ENGINE_CAPABILITY.priority ?? 10,
      globalStatsKinds: ["row-count"],
      runtimeStatsKinds: ["rows-examined", "rows-returned", "time-ms"],
      metadata: {
        role: "scan",
      },
    };
  }

  plan(_pred: BoundPredicate, _ctx: PlanContext): EnginePlanResult | null {
    return null;
  }

  async execute(
    plan: EnginePlanResult,
    instr: EngineInstrumentation,
  ): Promise<EngineRowSet> {
    const handle = plan.handle as ArrayScanPlanHandle;
    const endTimer = instr.beginOperation("array-scan");
    try {
      instr.recordStat("rows-examined", handle.rows.length);
      instr.recordStat("rows-returned", handle.rows.length);
      return { kind: "rows", rows: [...handle.rows] };
    } finally {
      endTimer();
    }
  }

  getColumnStats(_column: string): EngineColumnStats | undefined {
    return undefined;
  }
}
