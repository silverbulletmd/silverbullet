/**
 * BitmapEngine: implements the unified `QueryEngine` contract over the
 * existing `ObjectIndex` bitmap-extended scan.
 */
import type {
  BoundCompositePredicate,
  BoundLeafPredicate,
  BoundPredicate,
  EngineColumnStats,
  EngineInstrumentation,
  EnginePlanResult,
  EngineRowSet,
  EngineSpec,
  PlanContext,
  QueryEngine,
} from "../space_lua/engine_contract.ts";

// Internal predicate shape consumed by the host bitmap matcher
export type BitmapEnginePredicate =
  | { kind: "eq"; column: string; value: string | number | boolean }
  | { kind: "neq"; column: string; value: string | number | boolean }
  | { kind: "gt"; column: string; value: string | number | boolean }
  | { kind: "gte"; column: string; value: string | number | boolean }
  | { kind: "lt"; column: string; value: string | number | boolean }
  | { kind: "lte"; column: string; value: string | number | boolean }
  | { kind: "in"; column: string; values: (string | number | boolean)[] };

// The small subset of `ObjectIndex` capabilities the engine needs
export interface BitmapEngineHostSnapshot {
  tagName: string;
  trusted: boolean;
  indexComplete: boolean;
  columns: BitmapEngineColumnSnapshot[];
  rowCount: number;
  averageColumnCount: number;
}

export interface BitmapEngineColumnSnapshot {
  name: string;
  indexed: boolean;
  ndv?: number;
  mcvSize?: number;
  alwaysIndexed: boolean;
}

export interface BitmapEngineHost {
  snapshot(): BitmapEngineHostSnapshot;
  matchPredicates(
    preds: BitmapEnginePredicate[],
  ): Promise<number[] | undefined>;
  loadObjects(ids: number[]): Promise<any[]>;
}

interface BitmapPlanHandle {
  preds: BitmapEnginePredicate[];
}

// The engine itself

export class BitmapEngine implements QueryEngine {
  private constructor(
    private readonly host: BitmapEngineHost,
    private readonly snapshot: BitmapEngineHostSnapshot,
    private readonly cachedSpec: EngineSpec,
    private readonly columnIndex: Map<string, BitmapEngineColumnSnapshot>,
  ) {}

  static async create(host: BitmapEngineHost): Promise<BitmapEngine> {
    const snapshot = host.snapshot();
    const cachedSpec = buildEngineSpec(snapshot);
    const columnIndex = new Map<string, BitmapEngineColumnSnapshot>();
    for (const col of snapshot.columns) {
      columnIndex.set(col.name, col);
    }
    return new BitmapEngine(host, snapshot, cachedSpec, columnIndex);
  }

  spec(): EngineSpec {
    return this.cachedSpec;
  }

  plan(pred: BoundPredicate, _ctx: PlanContext): EnginePlanResult | null {
    if (!this.snapshot.trusted) {
      return null;
    }

    const { claimedLeaves, claimedExprs, residualChildren } =
      partitionConjuncts(pred, (leaf) => this.canClaimLeaf(leaf));

    if (claimedLeaves.length === 0) return null;

    const handle: BitmapPlanHandle = {
      preds: claimedLeaves.map(leafToBitmapPred),
    };

    const claimed: BoundPredicate =
      claimedExprs.length === 1
        ? claimedExprs[0]
        : composeAnd(claimedExprs, pred);

    const residual: BoundPredicate | null =
      residualChildren.length === 0
        ? null
        : residualChildren.length === 1
          ? residualChildren[0]
          : composeAnd(residualChildren, pred);

    return {
      claimed,
      residual,
      estimatedCost: this.cachedSpec.baseCostWeight * claimedLeaves.length,
      estimatedRows: this.snapshot.rowCount,
      handle,
    };
  }

  async execute(
    plan: EnginePlanResult,
    instr: EngineInstrumentation,
  ): Promise<EngineRowSet> {
    const handle = plan.handle as BitmapPlanHandle;
    const endTimer = instr.beginOperation("bitmap-match");
    let ids: number[] | undefined;
    try {
      ids = await this.host.matchPredicates(handle.preds);
    } finally {
      endTimer();
    }
    if (ids === undefined) {
      instr.recordEvent("bitmap-declined", {
        reason: "match-predicates-returned-undefined",
      });
      return {
        kind: "declined",
        reason: "match-predicates-returned-undefined",
      };
    }
    instr.recordStat("rows-returned", ids.length);
    instr.recordStat("rows-examined", this.snapshot.rowCount);
    return {
      kind: "ids",
      relation: this.snapshot.tagName,
      ids: new Set(ids),
    };
  }

  getColumnStats(column: string): EngineColumnStats | undefined {
    const col = this.columnIndex.get(column);
    if (!col) return undefined;
    if (!this.snapshot.indexComplete) {
      // While the index is still building, NDV/MCV are unreliable
      return { rowCount: this.snapshot.rowCount };
    }
    return {
      rowCount: this.snapshot.rowCount,
      ndv: col.ndv,
    };
  }

  async resolveIds(
    ids: Iterable<number>,
    instr: EngineInstrumentation,
  ): Promise<any[]> {
    const idArray = Array.from(ids);
    const endTimer = instr.beginOperation("bitmap-resolve-ids");
    try {
      const rows = await this.host.loadObjects(idArray);
      instr.recordStat("rows-returned", rows.length);
      return rows;
    } finally {
      endTimer();
    }
  }

  // Internals

  private canClaimLeaf(leaf: BoundLeafPredicate): boolean {
    const col = this.columnIndex.get(leaf.column);
    if (!col || !col.indexed) return false;
    switch (leaf.op) {
      case "eq":
      case "neq":
      case "lt":
      case "lte":
      case "gt":
      case "gte":
        return isLiteralValue(leaf.value);
      case "in":
        return (
          (leaf.values?.length ?? 0) > 0 && leaf.values!.every(isLiteralValue)
        );
      default:
        return false;
    }
  }
}

// Spec construction

function buildEngineSpec(snapshot: BitmapEngineHostSnapshot): EngineSpec {
  const indexedColumns = snapshot.columns.filter((c) => c.indexed);
  const supportedPredicateKinds = [
    "eq",
    "neq",
    "lt",
    "lte",
    "gt",
    "gte",
    "in",
  ] as const;

  return {
    id: snapshot.trusted ? "object-index-bitmap-extended" : "object-index-scan",
    name: snapshot.trusted
      ? "Object index bitmap extended scan"
      : "Object index scan (untrusted)",
    kind: "index",
    relation: snapshot.tagName,
    columns: indexedColumns.map((col) => ({
      name: col.name,
      predicateKinds: supportedPredicateKinds.slice(),
      valueKinds: ["literal"],
      statsKinds: snapshot.indexComplete ? ["ndv", "mcv"] : [],
    })),
    composites: ["and"],
    baseCostWeight: snapshot.trusted ? 0.6 : 1.0,
    priority: snapshot.trusted ? 20 : 10,
    globalStatsKinds: ["row-count"],
    runtimeStatsKinds: [
      "rows-examined",
      "rows-returned",
      "time-ms",
      "bitmap-population-ms",
      "bitmap-intersection-ms",
    ],
    metadata: {
      indexComplete: snapshot.indexComplete,
      averageColumnCount: snapshot.averageColumnCount,
    },
  };
}

function partitionConjuncts(
  pred: BoundPredicate,
  canClaim: (leaf: BoundLeafPredicate) => boolean,
): {
  claimedLeaves: BoundLeafPredicate[];
  claimedExprs: BoundPredicate[];
  residualChildren: BoundPredicate[];
} {
  const claimedLeaves: BoundLeafPredicate[] = [];
  const claimedExprs: BoundPredicate[] = [];
  const residualChildren: BoundPredicate[] = [];

  for (const child of flattenAndChildren(pred)) {
    if (child.kind === "leaf" && canClaim(child)) {
      claimedLeaves.push(child);
      claimedExprs.push(child);
    } else {
      residualChildren.push(child);
    }
  }

  return { claimedLeaves, claimedExprs, residualChildren };
}

function flattenAndChildren(pred: BoundPredicate): BoundPredicate[] {
  if (pred.kind === "composite" && pred.op === "and") {
    return pred.children.flatMap(flattenAndChildren);
  }
  return [pred];
}

function composeAnd(
  children: BoundPredicate[],
  shapeFrom: BoundPredicate,
): BoundCompositePredicate {
  return {
    kind: "composite",
    op: "and",
    children,
    expr: shapeFrom.expr,
  };
}

function leafToBitmapPred(leaf: BoundLeafPredicate): BitmapEnginePredicate {
  switch (leaf.op) {
    case "in":
      return {
        kind: "in",
        column: leaf.column,
        values: leaf.values!.map(literalToScalar),
      };
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return {
        kind: leaf.op,
        column: leaf.column,
        value: literalToScalar(leaf.value!),
      };
    default:
      throw new Error(
        `BitmapEngine: unexpected leaf op "${leaf.op}" reached ` +
          `leafToBitmapPred (a planner bug)`,
      );
  }
}

function literalToScalar(bv: {
  kind: string;
  value?: any;
}): string | number | boolean {
  switch (bv.kind) {
    case "literal-string":
    case "literal-number":
    case "literal-boolean":
      return bv.value;
    default:
      // Should be unreachable: `canClaimLeaf` filters non-literals out.
      throw new Error(
        `BitmapEngine: tried to scalarize non-literal value of kind ` +
          `"${bv.kind}" (a planner bug)`,
      );
  }
}

function isLiteralValue(v: { kind: string } | undefined): boolean {
  if (!v) return false;
  return (
    v.kind === "literal-string" ||
    v.kind === "literal-number" ||
    v.kind === "literal-boolean"
  );
}
