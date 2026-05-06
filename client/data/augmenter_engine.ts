/**
 * AugmenterEngine: implements the unified `QueryEngine` contract over
 * the existing `Augmenter` overlay.
 *
 * The augmenter is an "overlay" engine: in-memory key/record cache
 * that owns a small set of virtual columns on a relation that is
 * primarily backed by the bitmap engine.
 */
import type { AugmenterMatchPredicate } from "./data_augmenter.ts";
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

// Host interface

// Per-column augmenter snapshot consumed by the engine
export interface AugmenterEngineColumnSnapshot {
  name: string;
  rowCount: number;
  ndv: number;
}

export interface AugmenterEngineHostSnapshot {
  tagName: string;
  loaded: boolean;
  columns: AugmenterEngineColumnSnapshot[];
  cacheSize: number;
}

export interface AugmenterEngineHost {
  snapshot(): AugmenterEngineHostSnapshot;
  matchPredicates(
    preds: AugmenterMatchPredicate[],
  ): { cacheKeys: Set<string>; needsUniverse: boolean } | undefined;
  lookupObjectIdsByKeys(refs: ReadonlySet<string>): Promise<number[]>;
  allObjectIdsForTag(): Promise<number[]>;
  cachedKeys(): Iterable<string>;
}

// Engine plan handle

interface AugmenterPlanHandle {
  preds: AugmenterMatchPredicate[];
  pureIsNil: boolean;
}

// The engine itself

const SUPPORTED_PREDICATE_KINDS = [
  "eq",
  "neq",
  "lt",
  "lte",
  "gt",
  "gte",
  "is-nil",
  "is-not-nil",
] as const;

type SupportedKind = (typeof SUPPORTED_PREDICATE_KINDS)[number];

export class AugmenterEngine implements QueryEngine {
  private constructor(
    private readonly host: AugmenterEngineHost,
    private readonly snapshot: AugmenterEngineHostSnapshot,
    private readonly cachedSpec: EngineSpec,
    private readonly columnIndex: Map<string, AugmenterEngineColumnSnapshot>,
  ) {}

  static async create(host: AugmenterEngineHost): Promise<AugmenterEngine> {
    const snapshot = host.snapshot();
    const cachedSpec = buildEngineSpec(snapshot);
    const columnIndex = new Map<string, AugmenterEngineColumnSnapshot>();
    for (const col of snapshot.columns) {
      columnIndex.set(col.name, col);
    }
    return new AugmenterEngine(host, snapshot, cachedSpec, columnIndex);
  }

  spec(): EngineSpec {
    return this.cachedSpec;
  }

  plan(pred: BoundPredicate, _ctx: PlanContext): EnginePlanResult | null {
    if (!this.snapshot.loaded) return null;
    if (this.columnIndex.size === 0) return null;

    const { claimedLeaves, claimedExprs, residualChildren } =
      partitionConjuncts(pred, (leaf) => this.canClaimLeaf(leaf));

    if (claimedLeaves.length === 0) return null;

    const augPreds = claimedLeaves.map(leafToAugmenterPred);
    const pureIsNil = augPreds.every((p) => p.kind === "is-nil");

    const handle: AugmenterPlanHandle = { preds: augPreds, pureIsNil };

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

    // Cost estimate: in-memory hash-map probe per claim. Strictly
    // cheaper than a bitmap intersection so the augmenter wins routing
    // for owned columns even when the bitmap could pretend to handle
    // them via a `scan-bitmap` fallback.
    return {
      claimed,
      residual,
      estimatedCost: this.cachedSpec.baseCostWeight * augPreds.length,
      // Without histograms the best we have is the augmenter cache
      // size as an upper bound.
      estimatedRows: this.snapshot.cacheSize,
      handle,
    };
  }

  async execute(
    plan: EnginePlanResult,
    instr: EngineInstrumentation,
  ): Promise<EngineRowSet> {
    const handle = plan.handle as AugmenterPlanHandle;
    const endTimer = instr.beginOperation("augmenter-match");
    let matchResult: ReturnType<AugmenterEngineHost["matchPredicates"]>;
    try {
      matchResult = this.host.matchPredicates(handle.preds);
    } finally {
      endTimer();
    }

    if (!matchResult) {
      instr.recordEvent("augmenter-empty-predicates");
      return {
        kind: "ids",
        relation: this.snapshot.tagName,
        ids: new Set(),
      };
    }

    const { cacheKeys, needsUniverse } = matchResult;

    const lookupTimer = instr.beginOperation("augmenter-lookup-ids");
    let cacheKeyIds: number[];
    try {
      cacheKeyIds = await this.host.lookupObjectIdsByKeys(cacheKeys);
    } finally {
      lookupTimer();
    }

    let finalIds: Set<number>;
    if (needsUniverse) {
      // Purely is-nil conjunction: union the in-cache matches with
      // every key absent from the cache
      const universeTimer = instr.beginOperation("augmenter-universe-scan");
      let universe: number[];
      try {
        universe = await this.host.allObjectIdsForTag();
      } finally {
        universeTimer();
      }
      // Resolve every cached key (regardless of whether it matched
      // the predicate) to its object id.
      const presentKeys = new Set<string>(this.host.cachedKeys());
      const presentIds = new Set(
        await this.host.lookupObjectIdsByKeys(presentKeys),
      );
      finalIds = new Set(cacheKeyIds);
      for (const id of universe) {
        if (!presentIds.has(id)) finalIds.add(id);
      }
    } else {
      finalIds = new Set(cacheKeyIds);
    }

    instr.recordStat("rows-returned", finalIds.size);
    instr.recordStat("rows-examined", this.snapshot.cacheSize);

    return {
      kind: "ids",
      relation: this.snapshot.tagName,
      ids: finalIds,
    };
  }

  getColumnStats(column: string): EngineColumnStats | undefined {
    const col = this.columnIndex.get(column);
    if (!col) return undefined;
    return {
      rowCount: col.rowCount,
      ndv: col.ndv,
    };
  }

  private canClaimLeaf(leaf: BoundLeafPredicate): boolean {
    if (!this.columnIndex.has(leaf.column)) return false;
    if (!isSupportedKind(leaf.op)) return false;
    if (leaf.op === "is-nil" || leaf.op === "is-not-nil") {
      return true;
    }
    return isLiteralValue(leaf.value);
  }
}

// Spec construction

function buildEngineSpec(snapshot: AugmenterEngineHostSnapshot): EngineSpec {
  return {
    id: `augmenter-overlay-${snapshot.tagName}`,
    name: `Augmenter overlay (${snapshot.tagName})`,
    kind: "overlay",
    relation: snapshot.tagName,
    columns: snapshot.columns.map((col) => ({
      name: col.name,
      predicateKinds: SUPPORTED_PREDICATE_KINDS.slice(),
      valueKinds: ["literal"],
      statsKinds: ["ndv"],
    })),
    composites: ["and"],
    // Augmenter is an in-memory hash-map probe strictly cheaper than
    // a bitmap intersection! Keep below the bitmap engine's base
    // weight so the planner prefers the augmenter for owned columns.
    baseCostWeight: 0.4,
    priority: 25,
    globalStatsKinds: ["row-count"],
    runtimeStatsKinds: [
      "rows-examined",
      "rows-returned",
      "time-ms",
      "cache-hits",
      "cache-misses",
    ],
    metadata: {
      cacheSize: snapshot.cacheSize,
      ownedColumnCount: snapshot.columns.length,
      loaded: snapshot.loaded,
    },
  };
}

// AND-conjunct partitioning

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

// Leaf to AugmenterMatchPredicate conversion

function leafToAugmenterPred(
  leaf: BoundLeafPredicate,
): AugmenterMatchPredicate {
  switch (leaf.op) {
    case "is-nil":
      return { kind: "is-nil", column: leaf.column };
    case "is-not-nil":
      return { kind: "is-not-nil", column: leaf.column };
    case "eq":
    case "neq":
    case "lt":
    case "lte":
    case "gt":
    case "gte":
      return {
        kind: leaf.op,
        column: leaf.column,
        value: literalToScalar(leaf.value!),
      };
    default:
      throw new Error(
        `AugmenterEngine: unexpected leaf op "${leaf.op}" reached ` +
          `leafToAugmenterPred (a planner bug)`,
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
      throw new Error(
        `AugmenterEngine: tried to scalarize non-literal value of kind ` +
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

function isSupportedKind(op: string): op is SupportedKind {
  return (SUPPORTED_PREDICATE_KINDS as readonly string[]).includes(op);
}
