/**
 * Cost-Based Join Planner for SLIQ (Space Lua Integrated Query).
 *
 * Transforms a multi-source `from` clause into an optimized join tree,
 * then executes it using hash join, nested loop, or sort-merge operators.
 */
import type {
  LuaExpression,
  LuaFunctionBody,
  LuaJoinHint,
  LuaOrderBy,
  LuaWithHints,
} from "./ast.ts";
import { evalExpression, luaTableToArray } from "./eval.ts";
import {
  collectionHasPlannerCapability,
  collectionPrimaryEngine,
  isExprGroupByEntry,
  type AggregateRuntimeStats,
  type CollectionStats,
  type LuaGroupByEntry,
  type StatsSource,
  type VirtualColumnInfo,
} from "./query_collection.ts";
import {
  LuaEnv,
  LuaFunction,
  LuaRuntimeError,
  type LuaStackFrame,
  LuaTable,
  type LuaValue,
  luaCall,
  luaKeys,
  luaTruthy,
  singleResult,
} from "./runtime.ts";
import { MCVList } from "./mcv.ts";
import { getAggregateSpec } from "./aggregates.ts";
import type { Config } from "../config.ts";

const DEFAULT_WATCHDOG_LIMIT = 5e5;
const DEFAULT_YIELD_CHUNK = 5000;
const DEFAULT_SMALL_TABLE_THRESHOLD = 20;
const DEFAULT_RANGE_SELECTIVITY = 0.33;
const DEFAULT_MERGE_JOIN_THRESHOLD = 200;
const DEFAULT_WIDTH_WEIGHT = 1;
const DEFAULT_CANDIDATE_WIDTH_WEIGHT = 2;
const DEFAULT_ESTIMATED_ROWS = 100;
const DEFAULT_ESTIMATED_WIDTH = 5;
const DEFAULT_SEMI_ANTI_LOOP_DISCOUNT = 0.5;
const DEFAULT_PARTIAL_STATS_CONFIDENCE = 0.25;
const DEFAULT_APPROXIMATE_STATS_CONFIDENCE = 0.5;
const DEFAULT_BITMAP_SCAN_PENALTY = 0.6;
const DEFAULT_INDEX_SCAN_NO_PUSHDOWN_PENALTY = 2.0;
const DEFAULT_KV_SCAN_PENALTY = 1.4;
const DEFAULT_FILTER_SELECTIVITY = 0.5;
const DEFAULT_DISTINCT_SURVIVAL_RATIO = 0.8;
const DEFAULT_INFERRED_NDV_DIVISOR = 2;

export type MaterializedSourceOverrides = Map<string, any[]>;

export type JoinPlannerConfig = {
  watchdogLimit?: number;
  yieldChunk?: number;
  smallTableThreshold?: number;
  mergeJoinThreshold?: number;
  widthWeight?: number;
  candidateWidthWeight?: number;
  semiAntiLoopDiscount?: number;
  partialStatsConfidence?: number;
  approximateStatsConfidence?: number;
  bitmapScanPenalty?: number;
  indexScanNoPushdownPenalty?: number;
  kvScanPenalty?: number;
  defaultFilterSelectivity?: number;
  defaultDistinctSurvivalRatio?: number;
  defaultRangeSelectivity?: number;
  inferredNdvDivisor?: number;
};

function getWatchdogLimit(config?: JoinPlannerConfig): number {
  return config?.watchdogLimit ?? DEFAULT_WATCHDOG_LIMIT;
}

function getYieldChunk(config?: JoinPlannerConfig): number {
  return config?.yieldChunk ?? DEFAULT_YIELD_CHUNK;
}

function finiteNumberOrDefault(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getSmallTableThreshold(config?: JoinPlannerConfig): number {
  return finiteNumberOrDefault(
    config?.smallTableThreshold,
    DEFAULT_SMALL_TABLE_THRESHOLD,
  );
}

function getMergeJoinThreshold(config?: JoinPlannerConfig): number {
  return finiteNumberOrDefault(
    config?.mergeJoinThreshold,
    DEFAULT_MERGE_JOIN_THRESHOLD,
  );
}

function getWidthWeight(config?: JoinPlannerConfig): number {
  return finiteNumberOrDefault(config?.widthWeight, DEFAULT_WIDTH_WEIGHT);
}

function getCandidateWidthWeight(config?: JoinPlannerConfig): number {
  return finiteNumberOrDefault(
    config?.candidateWidthWeight,
    DEFAULT_CANDIDATE_WIDTH_WEIGHT,
  );
}

function getSemiAntiLoopDiscount(config?: JoinPlannerConfig): number {
  return finiteNumberOrDefault(
    config?.semiAntiLoopDiscount,
    DEFAULT_SEMI_ANTI_LOOP_DISCOUNT,
  );
}

function getPartialStatsConfidence(config?: JoinPlannerConfig): number {
  return finiteNumberOrDefault(
    config?.partialStatsConfidence,
    DEFAULT_PARTIAL_STATS_CONFIDENCE,
  );
}

function getApproximateStatsConfidence(config?: JoinPlannerConfig): number {
  return finiteNumberOrDefault(
    config?.approximateStatsConfidence,
    DEFAULT_APPROXIMATE_STATS_CONFIDENCE,
  );
}

function getBitmapScanPenalty(config?: JoinPlannerConfig): number {
  return finiteNumberOrDefault(
    config?.bitmapScanPenalty,
    DEFAULT_BITMAP_SCAN_PENALTY,
  );
}

function getIndexScanNoPushdownPenalty(config?: JoinPlannerConfig): number {
  return finiteNumberOrDefault(
    config?.indexScanNoPushdownPenalty,
    DEFAULT_INDEX_SCAN_NO_PUSHDOWN_PENALTY,
  );
}

function getKvScanPenalty(config?: JoinPlannerConfig): number {
  return finiteNumberOrDefault(config?.kvScanPenalty, DEFAULT_KV_SCAN_PENALTY);
}

function getDefaultFilterSelectivity(config?: JoinPlannerConfig): number {
  return finiteNumberOrDefault(
    config?.defaultFilterSelectivity,
    DEFAULT_FILTER_SELECTIVITY,
  );
}

function getDefaultDistinctSurvivalRatio(config?: JoinPlannerConfig): number {
  return finiteNumberOrDefault(
    config?.defaultDistinctSurvivalRatio,
    DEFAULT_DISTINCT_SURVIVAL_RATIO,
  );
}

function getDefaultRangeSelectivity(config?: JoinPlannerConfig): number {
  return finiteNumberOrDefault(
    config?.defaultRangeSelectivity,
    DEFAULT_RANGE_SELECTIVITY,
  );
}

function getInferredNdvDivisor(config?: JoinPlannerConfig): number {
  return finiteNumberOrDefault(
    config?.inferredNdvDivisor,
    DEFAULT_INFERRED_NDV_DIVISOR,
  );
}

export type JoinType = "inner" | "semi" | "anti";

export type JoinSource = {
  name: string;
  expression: LuaExpression;
  hint?: LuaJoinHint;
  stats?: CollectionStats;
  joinType?: JoinType;
  materialized?: boolean;
  withHints?: LuaWithHints;
};

export type JoinNode = JoinLeaf | JoinInner;

export type JoinLeaf = {
  kind: "leaf";
  source: JoinSource;
};

export type JoinInner = {
  kind: "join";
  left: JoinNode;
  right: JoinNode;
  method: "hash" | "loop" | "merge";
  joinType: JoinType;
  equiPred?: EquiPredicate;
  joinResiduals?: LuaExpression[];
  estimatedSelectivity?: number;
  estimatedRows?: number;
  estimatedNdv?: Map<string, Map<string, number>>;
  estimatedMcv?: Map<string, Map<string, MCVList>>;
  statsSource?: JoinStatsSummary;
  // Selectivity provenance (EXPLAIN VERBOSE).
  selectivityTrace?: JoinSelectivityTrace;
};

export type EquiPredicate = {
  leftSource: string;
  leftColumn: string;
  rightSource: string;
  rightColumn: string;
};

export type RangePredicate = {
  leftSource: string;
  leftColumn: string;
  operator: ">" | "<" | ">=" | "<=";
  rightSource: string;
  rightColumn: string;
};

export type OpStats = {
  actualRows: number;
  loops: number;
  rebinds: number;
  startTimeMs: number;
  endTimeMs: number;
  peakMemoryRows: number;
};

type JoinStatsSummary = "exact" | "approximate" | "partial" | "unknown";

// Either `expr` or `wildcard` is set; wildcards are expanded at runtime.
export type OrderByEntry = {
  expr?: LuaExpression;
  wildcard?:
    | { kind: "all" }
    | { kind: "source"; source: string }
    | { kind: "column"; column: string };
  desc: boolean;
  nulls?: "first" | "last";
  using?: unknown;
};

export type ExplainNodeType =
  | "Scan"
  | "FunctionScan"
  | "Filter"
  | "HashJoin"
  | "NestedLoop"
  | "MergeJoin"
  | "Sort"
  | "Limit"
  | "GroupAggregate"
  | "Project"
  | "Unique";

export type ExplainNode = {
  nodeType: ExplainNodeType;
  joinType?: JoinType;
  source?: string;
  functionCall?: string;
  method?: "hash" | "loop" | "merge";
  hintUsed?: string;
  sourceHints?: string[];
  startupCost: number;
  estimatedCost: number;
  estimatedRows: number;
  estimatedWidth: number;
  actualRows?: number;
  actualLoops?: number;
  actualStartupTimeMs?: number;
  actualTimeMs?: number;
  memoryRows?: number;
  hashBuckets?: number;
  // Hash join: which side was built (smaller side at runtime).
  hashBuildSide?: "left" | "right";
  rowsRemovedByFilter?: number;
  // Rows cut by engine pushdown only (vs residual `rowsRemovedByFilter`).
  rowsRemovedByPushdownCond?: number;
  rowsRemovedByJoinFilter?: number;
  rowsRemovedByInlineFilter?: number;
  rowsRemovedByUnique?: number;
  equiPred?: EquiPredicate;
  joinResidualExprs?: string[];
  filterExpr?: string;
  sortKeys?: string[];
  limitCount?: number;
  offsetCount?: number;
  children: ExplainNode[];

  whereExpr?: LuaExpression;
  havingExpr?: LuaExpression;
  orderBySpec?: {
    expr?: LuaExpression;
    wildcard?:
      | { kind: "all" }
      | { kind: "source"; source: string }
      | { kind: "column"; column: string };
    desc: boolean;
    nulls?: "first" | "last";
    using?: string;
  }[];
  groupBySpec?: LuaGroupByEntry[];
  distinctSpec?: boolean;

  outputColumns?: string[];
  // Original SELECT AST for Project nodes (wildcard `Output:` resolution).
  selectExpr?: LuaExpression;
  aggregates?: AggregateDescription[];
  implicitGroup?: boolean;
  filterType?: "where" | "having" | "aggregate";
  pushedDownFilter?: boolean;
  joinFilterType?: "join" | "join-residual";
  sortType?: "query" | "group";
  rowsRemovedByAggregateFilter?: number;

  selectivity?: number;
  // Selectivity provenance (EXPLAIN VERBOSE).
  selectivityTrace?: JoinSelectivityTrace;
  ndvSource?:
    | "roaring-bitmap index"
    | "half-xor heuristic"
    | "row-count heuristic";
  mcvUsed?: boolean;
  mcvFallback?: "one-sided" | "no-mcv" | "suppressed";
  mcvKeyCount?: number;
  joinKeyNdv?: {
    left: string;
    leftNdv: number;
    right: string;
    rightNdv: number;
  };
  statsSource?: string;
  executionScanKind?: string;
  predicatePushdown?: string;
  normalizationState?: "complete" | "partial";
  originalPredicateExpr?: string;
  normalizedPredicateExpr?: string;
  normalizedPushdownExpr?: string;
  normalizedLeftoverExpr?: string;

  engineIds?: string[];
  plannerCapabilities?: string[];
  /** Per-engine identity + capabilities + optional `Owns:` virtual columns
   *  (EXPLAIN VERBOSE). */
  engineCapabilityBreakdown?: Array<{
    id: string;
    name?: string;
    kind?: string;
    role: "primary" | "augmenter-overlay";
    capabilities: string[];
    baseCostWeight?: number;
    priority?: number;
    ownedColumns?: VirtualColumnInfo[];
    // EXPLAIN ANALYZE `Runtime:` line per engine (when executed).
    runtimeStats?: Partial<Record<string, number>>;
    executeMs?: number;
  }>;

  // Virtual columns from stats (e.g. augmenter); shown on scan in EXPLAIN VERBOSE.
  virtualColumns?: VirtualColumnInfo[];
};

export type AggregateDescription = {
  name: string;
  args: string;
  filter?: string;
  orderBy?: string;
  rowsFiltered?: number;
};

export type ExplainOptions = {
  analyze: boolean;
  verbose: boolean;
  summary: boolean;
  costs: boolean;
  timing: boolean;
  hints: boolean;
};

export type ExplainResult = {
  plan: ExplainNode;
  planningTimeMs: number;
  executionTimeMs?: number;
  // Real result keys vs symbolic plan `Output:` (EXPLAIN ANALYZE VERBOSE).
  resultColumns?: string[];
  leadingHint?: LeadingHintInfo;
  // Tautologies removed from WHERE (EXPLAIN VERBOSE only).
  prunedPredicates?: string[];
};

export type SourceNormalizationInfo = {
  state: "complete" | "partial";
  originalExpr: string;
  normalizedExpr: string;
  pushdownExpr: string;
  leftoverExpr: string;
};

export type LeadingHintInfo = {
  original: string[];
  requested: string[];
  fixed: string[];
  plannerChosen: string[];
  finalOrder: string[];
};

function isPartialStatsSource(source: StatsSource | undefined): boolean {
  return source === "persisted-partial";
}

function isApproximateStatsSource(source: StatsSource | undefined): boolean {
  return (
    source === "computed-sketch-large" ||
    source === "source-provided-unknown" ||
    source === "unknown-default"
  );
}

function summarizeJoinStatsSource(
  left: StatsSource | undefined,
  right: StatsSource | undefined,
): JoinStatsSummary {
  if (left === "persisted-partial" || right === "persisted-partial") {
    return "partial";
  }
  if (isApproximateStatsSource(left) || isApproximateStatsSource(right)) {
    return "approximate";
  }
  if (left || right) {
    return "exact";
  }
  return "unknown";
}

function shouldAvoidAggressiveReordering(sources: JoinSource[]): boolean {
  return sources.some((s) => isPartialStatsSource(s.stats?.statsSource));
}

function canUseMcvForPlanning(
  leftSource: StatsSource | undefined,
  rightSource: StatsSource | undefined,
): boolean {
  const trusted = (s: StatsSource | undefined) =>
    s === "persisted-complete" || s === "recomputed-filtered-exact";
  return trusted(leftSource) && trusted(rightSource);
}

function ndvConfidenceMultiplier(
  leftSource: StatsSource | undefined,
  rightSource: StatsSource | undefined,
  config?: JoinPlannerConfig,
): number {
  if (isPartialStatsSource(leftSource) || isPartialStatsSource(rightSource)) {
    return getPartialStatsConfidence(config);
  }
  if (
    isApproximateStatsSource(leftSource) ||
    isApproximateStatsSource(rightSource)
  ) {
    return getApproximateStatsConfidence(config);
  }
  return 1.0;
}

function estimatedRows(s: JoinSource): number {
  return s.withHints?.rows ?? s.stats?.rowCount ?? DEFAULT_ESTIMATED_ROWS;
}

function estimatedWidth(s: JoinSource): number {
  return (
    s.withHints?.width ?? s.stats?.avgColumnCount ?? DEFAULT_ESTIMATED_WIDTH
  );
}

function estimatedSourceCost(s: JoinSource): number {
  return s.withHints?.cost ?? estimatedRows(s);
}

function clampWidth(width: number): number {
  return Math.max(1, width);
}

function estimateJoinCardinality(
  leftCard: number,
  rightCard: number,
  joinType: JoinType,
  selectivity: number,
): number {
  switch (joinType) {
    case "inner":
      return leftCard * rightCard * selectivity;
    case "semi":
      return Math.min(
        leftCard,
        leftCard * Math.min(1, rightCard * selectivity),
      );
    case "anti":
      return leftCard * Math.max(0, 1 - Math.min(1, rightCard * selectivity));
  }
}

function estimateRangeSelectivity(
  rangePredicates: RangePredicate[],
  leftNames: Set<string>,
  rightName: string,
  config?: JoinPlannerConfig,
): number {
  let sel = 1.0;
  const rangeSel = getDefaultRangeSelectivity(config);
  for (const rp of rangePredicates) {
    if (
      (leftNames.has(rp.leftSource) && rp.rightSource === rightName) ||
      (leftNames.has(rp.rightSource) && rp.leftSource === rightName)
    ) {
      sel *= rangeSel;
    }
  }
  return sel;
}

function getNodeNdv(node: JoinNode): Map<string, Map<string, number>> {
  const copy = new Map<string, Map<string, number>>();

  if (node.kind === "leaf") {
    const srcNdv = new Map<string, number>();
    for (const [col, ndv] of node.source.stats?.ndv ?? new Map()) {
      srcNdv.set(col, ndv);
    }
    copy.set(node.source.name, srcNdv);
    return copy;
  }

  for (const [src, colMap] of node.estimatedNdv ?? new Map()) {
    copy.set(src, new Map(colMap));
  }
  return copy;
}

function getNodeMcv(
  node: JoinNode,
): Map<string, Map<string, MCVList>> | undefined {
  if (node.kind === "leaf") {
    if (!node.source.stats?.mcv) return undefined;
    const result = new Map<string, Map<string, MCVList>>();
    result.set(node.source.name, node.source.stats.mcv);
    return result;
  }
  return node.estimatedMcv;
}

function getAccumulatedColumnNdv(
  ndv: Map<string, Map<string, number>> | undefined,
  source: string,
  column: string,
): number | undefined {
  return ndv?.get(source)?.get(column);
}

function estimateRowsPerKey(rowCount: number, ndv: number | undefined): number {
  if (ndv === undefined || ndv <= 0) {
    return 1;
  }
  return Math.max(1, rowCount / Math.max(1, ndv));
}

function estimateMatchedLeftFraction(
  leftNdv: number | undefined,
  rightNdv: number | undefined,
  joinedRows: number,
  candidateRows: number,
): number {
  if (
    leftNdv !== undefined &&
    leftNdv > 0 &&
    rightNdv !== undefined &&
    rightNdv > 0
  ) {
    return Math.min(1, rightNdv / leftNdv);
  }

  return Math.min(1, candidateRows / Math.max(1, joinedRows, candidateRows));
}

function estimateJoinKeyFanout(
  leftNdv: number | undefined,
  rightNdv: number | undefined,
  joinedRows: number,
  candidateRows: number,
  joinType: JoinType,
): {
  matchedLeftFraction: number;
  rightRowsPerKey: number;
  baseOutputRows: number;
} {
  const matchedLeftFraction = estimateMatchedLeftFraction(
    leftNdv,
    rightNdv,
    joinedRows,
    candidateRows,
  );
  const rightRowsPerKey = estimateRowsPerKey(candidateRows, rightNdv);

  let baseOutputRows: number;
  switch (joinType) {
    case "inner":
      baseOutputRows =
        joinedRows * matchedLeftFraction * Math.max(1, rightRowsPerKey);
      break;
    case "semi":
      baseOutputRows = joinedRows * matchedLeftFraction;
      break;
    case "anti":
      baseOutputRows = joinedRows * Math.max(0, 1 - matchedLeftFraction);
      break;
  }

  return {
    matchedLeftFraction,
    rightRowsPerKey,
    baseOutputRows,
  };
}

function propagateJoinNdv(
  leftNdv: Map<string, Map<string, number>>,
  rightLeafNdv: Map<string, number>,
  rightSourceName: string,
  joinType: JoinType,
  equiPred: EquiPredicate | undefined,
  joinedRows: number,
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();

  for (const [src, colMap] of leftNdv) {
    const capped = new Map<string, number>();
    for (const [col, ndv] of colMap) {
      capped.set(col, Math.min(Math.max(1, ndv), Math.max(1, joinedRows)));
    }
    result.set(src, capped);
  }

  if (joinType === "inner") {
    const rightCapped = new Map<string, number>();
    for (const [col, ndv] of rightLeafNdv) {
      rightCapped.set(col, Math.min(Math.max(1, ndv), Math.max(1, joinedRows)));
    }
    result.set(rightSourceName, rightCapped);
  }

  if (equiPred) {
    const leftColNdv = leftNdv
      .get(equiPred.leftSource)
      ?.get(equiPred.leftColumn);
    const rightColNdv = rightLeafNdv.get(equiPred.rightColumn);

    const keyNdv = Math.max(
      1,
      Math.min(
        leftColNdv ?? Infinity,
        rightColNdv ?? Infinity,
        Math.max(1, joinedRows),
      ),
    );

    const leftMap = result.get(equiPred.leftSource);
    if (leftMap) {
      leftMap.set(equiPred.leftColumn, keyNdv);
    }

    if (joinType === "inner") {
      const rightMap = result.get(rightSourceName);
      if (rightMap) {
        rightMap.set(equiPred.rightColumn, keyNdv);
      }
    }
  }

  return result;
}

function propagateJoinMcv(
  leftMcv: Map<string, Map<string, MCVList>> | undefined,
  rightMcv: Map<string, MCVList> | undefined,
  rightSourceName: string,
  joinType: JoinType,
  equiPred?: EquiPredicate,
  leftNdvMap?: Map<string, Map<string, number>>,
  rightNdvMap?: Map<string, number>,
): Map<string, Map<string, MCVList>> | undefined {
  if (!leftMcv && !rightMcv) return undefined;

  const result = new Map<string, Map<string, MCVList>>();

  if (leftMcv) {
    for (const [src, colMap] of leftMcv) {
      const newColMap = new Map<string, MCVList>();
      for (const [col, mcv] of colMap) {
        newColMap.set(col, MCVList.deserialize(mcv.serialize()));
      }
      result.set(src, newColMap);
    }
  }

  if (joinType === "inner" && equiPred && leftMcv && rightMcv) {
    const leftColMcv = result
      .get(equiPred.leftSource)
      ?.get(equiPred.leftColumn);
    const rightColMcv = rightMcv.get(equiPred.rightColumn);

    if (leftColMcv && rightColMcv) {
      const amplified = new MCVList({ capacity: leftColMcv.capacity });

      const leftTracked = leftColMcv.trackedRowCount();
      const leftTotal = leftColMcv.totalCount();
      const leftColNdv =
        leftNdvMap?.get(equiPred.leftSource)?.get(equiPred.leftColumn) ??
        leftColMcv.trackedSize();
      const leftUntrackedNdv = Math.max(
        1,
        leftColNdv - leftColMcv.trackedSize(),
      );
      const leftUntrackedRows = Math.max(0, leftTotal - leftTracked);
      const leftAvgUntracked =
        leftUntrackedRows > 0 ? leftUntrackedRows / leftUntrackedNdv : 1;

      const rightTracked = rightColMcv.trackedRowCount();
      const rightTotal = rightColMcv.totalCount();
      const rightColNdv =
        rightNdvMap?.get(equiPred.rightColumn) ?? rightColMcv.trackedSize();
      const rightUntrackedNdv = Math.max(
        1,
        rightColNdv - rightColMcv.trackedSize(),
      );
      const rightUntrackedRows = Math.max(0, rightTotal - rightTracked);
      const rightAvgUntracked =
        rightUntrackedRows > 0 ? rightUntrackedRows / rightUntrackedNdv : 1;

      const seen = new Set<string>();

      rightColMcv.forEachEntry((value, rCount) => {
        seen.add(value);
        const leftCount = leftColMcv.getCount(value);
        const effectiveLeft = leftCount > 0 ? leftCount : leftAvgUntracked;
        const product = Math.round(effectiveLeft * rCount);
        if (product > 0) {
          amplified.setDirect(value, product);
        }
      });

      leftColMcv.forEachEntry((value, lCount) => {
        if (seen.has(value)) return;
        const rightCount = rightColMcv.getCount(value);
        const effectiveRight = rightCount > 0 ? rightCount : rightAvgUntracked;
        const product = Math.round(lCount * effectiveRight);
        if (product > 0) {
          amplified.setDirect(value, product);
        }
      });

      result.get(equiPred.leftSource)?.set(equiPred.leftColumn, amplified);
    }
  }

  if (joinType === "inner" && rightMcv) {
    result.set(rightSourceName, new Map(rightMcv));
  }

  return result.size > 0 ? result : undefined;
}

function collectSourceNames(node: JoinNode): Set<string> {
  const names = new Set<string>();
  const walk = (n: JoinNode) => {
    if (n.kind === "leaf") {
      names.add(n.source.name);
    } else {
      walk(n.left);
      walk(n.right);
    }
  };
  walk(node);
  return names;
}

function findEquiPredBetweenSets(
  leftNames: Set<string>,
  rightName: string,
  equiPreds?: EquiPredicate[],
): EquiPredicate | undefined {
  if (!equiPreds) return undefined;

  const pred = equiPreds.find(
    (ep) =>
      (leftNames.has(ep.leftSource) && ep.rightSource === rightName) ||
      (leftNames.has(ep.rightSource) && ep.leftSource === rightName),
  );
  if (!pred) return undefined;

  if (leftNames.has(pred.leftSource)) {
    return pred;
  }

  return {
    leftSource: pred.rightSource,
    leftColumn: pred.rightColumn,
    rightSource: pred.leftSource,
    rightColumn: pred.leftColumn,
  };
}

// Audit trail for join selectivity (EXPLAIN VERBOSE).
export type JoinSelectivityTrace = {
  source: "mcv-overlap" | "ndv-fanout" | "no-equi-fallback" | "range-only";
  leftNdv?: number;
  rightNdv?: number;
  leftMcvKeys?: number;
  rightMcvKeys?: number;
  // Applied after equi path (1.0 if no range preds).
  rangeMultiplier?: number;
};

function estimateJoinWithCandidate(
  joinedNames: Set<string>,
  joinedRows: number,
  joinedNdv: Map<string, Map<string, number>>,
  joinedMcv: Map<string, Map<string, MCVList>> | undefined,
  candidate: JoinSource,
  equiPreds?: EquiPredicate[],
  rangePreds?: RangePredicate[],
  joinType: JoinType = "inner",
  leftStatsSource?: StatsSource,
  config?: JoinPlannerConfig,
): {
  selectivity: number;
  equiPred?: EquiPredicate;
  outputRows: number;
  trace: JoinSelectivityTrace;
} {
  const equiPred = findEquiPredBetweenSets(
    joinedNames,
    candidate.name,
    equiPreds,
  );

  const candidateRows = estimatedRows(candidate);
  const rightStatsSource = candidate.stats?.statsSource;

  let outputRows: number;
  let equiSel: number;
  const trace: JoinSelectivityTrace = {
    source: "no-equi-fallback",
  };

  if (equiPred) {
    const observedLeftNdv = getAccumulatedColumnNdv(
      joinedNdv,
      equiPred.leftSource,
      equiPred.leftColumn,
    );
    const observedRightNdv = candidate.stats?.ndv?.get(equiPred.rightColumn);

    const ndvDivisor = getInferredNdvDivisor(config);
    const inferredLeftNdv = Math.max(1, Math.min(joinedRows, candidateRows));
    const inferredRightNdv = Math.max(
      1,
      Math.min(joinedRows, Math.ceil(candidateRows / ndvDivisor)),
    );

    const confidence = ndvConfidenceMultiplier(
      leftStatsSource,
      rightStatsSource,
      config,
    );

    const leftNdv = observedLeftNdv ?? inferredLeftNdv;
    const rightNdv = observedRightNdv ?? inferredRightNdv;

    const adjustedLeftNdv =
      confidence < 1 ? Math.max(1, Math.round(leftNdv / confidence)) : leftNdv;
    const adjustedRightNdv =
      confidence < 1
        ? Math.max(1, Math.round(rightNdv / confidence))
        : rightNdv;

    const leftMcv = joinedMcv
      ?.get(equiPred.leftSource)
      ?.get(equiPred.leftColumn);
    const rightMcv = candidate.stats?.mcv?.get(equiPred.rightColumn);

    const mcvAllowed = canUseMcvForPlanning(leftStatsSource, rightStatsSource);

    if (
      mcvAllowed &&
      leftMcv &&
      rightMcv &&
      leftMcv.trackedSize() > 0 &&
      rightMcv.trackedSize() > 0
    ) {
      const mcvEst = MCVList.estimateMatchFraction(
        leftMcv,
        rightMcv,
        joinedRows,
        candidateRows,
        adjustedLeftNdv,
        adjustedRightNdv,
      );

      switch (joinType) {
        case "inner":
          outputRows =
            joinedRows * mcvEst.matchedLeftFraction * mcvEst.avgRightRowsPerKey;
          break;
        case "semi":
          outputRows = joinedRows * mcvEst.matchedLeftFraction;
          break;
        case "anti":
          outputRows = joinedRows * Math.max(0, 1 - mcvEst.matchedLeftFraction);
          break;
      }

      trace.source = "mcv-overlap";
      trace.leftNdv = adjustedLeftNdv;
      trace.rightNdv = adjustedRightNdv;
      trace.leftMcvKeys = leftMcv.trackedSize();
      trace.rightMcvKeys = rightMcv.trackedSize();
    } else {
      const { baseOutputRows } = estimateJoinKeyFanout(
        adjustedLeftNdv,
        adjustedRightNdv,
        joinedRows,
        candidateRows,
        joinType,
      );
      outputRows = baseOutputRows;

      trace.source = "ndv-fanout";
      trace.leftNdv = adjustedLeftNdv;
      trace.rightNdv = adjustedRightNdv;
    }

    equiSel = outputRows / Math.max(1, joinedRows * candidateRows);
  } else {
    equiSel = 1 / Math.max(joinedRows, candidateRows, 1);
    outputRows = estimateJoinCardinality(
      joinedRows,
      candidateRows,
      joinType,
      equiSel,
    );
    trace.source = "no-equi-fallback";
  }

  const rangeSel = rangePreds
    ? estimateRangeSelectivity(rangePreds, joinedNames, candidate.name, config)
    : 1.0;

  outputRows *= rangeSel;
  if (rangeSel !== 1.0) trace.rangeMultiplier = rangeSel;

  if (joinType === "semi" || joinType === "anti") {
    outputRows = Math.min(joinedRows, outputRows);
  }

  outputRows = Math.max(1, Math.round(outputRows));

  const combinedSel = outputRows / Math.max(1, joinedRows * candidateRows);

  return { selectivity: combinedSel, equiPred, outputRows, trace };
}

type JoinCost = {
  startupCost: number;
  totalCost: number;
};

function computeJoinCost(
  method: "hash" | "loop" | "merge",
  joinType: JoinType,
  leftCost: number,
  leftRows: number,
  leftWidth: number,
  rightCost: number,
  rightRows: number,
  rightWidth: number,
  config?: JoinPlannerConfig,
): JoinCost {
  const ww = getWidthWeight(config);
  const cww = getCandidateWidthWeight(config);
  const lw = clampWidth(leftWidth);
  const rw = clampWidth(rightWidth);

  if (method === "hash") {
    const startupCost = rightCost + rightRows * cww * rw;
    const totalCost = startupCost + leftCost + leftRows;
    return { startupCost, totalCost };
  }

  if (method === "merge") {
    const leftSort =
      leftRows * Math.ceil(Math.log2(Math.max(2, leftRows))) * ww * lw;
    const rightSort =
      rightRows * Math.ceil(Math.log2(Math.max(2, rightRows))) * cww * rw;
    const startupCost = leftCost + rightCost + leftSort + rightSort;
    const totalCost = startupCost + leftRows * ww * lw + rightRows * cww * rw;
    return { startupCost, totalCost };
  }

  const startupCost = leftCost;
  const discount = joinType === "inner" ? 1.0 : getSemiAntiLoopDiscount(config);
  const totalCost =
    leftCost + leftRows * rightRows * discount * (ww * lw + cww * rw);
  return { startupCost, totalCost };
}

export function buildJoinTree(
  sources: JoinSource[],
  leading?: string[],
  equiPreds?: EquiPredicate[],
  rangePreds?: RangePredicate[],
  residualWhere?: LuaExpression,
  config?: JoinPlannerConfig,
): JoinNode {
  if (sources.length === 1) {
    return { kind: "leaf", source: sources[0] };
  }

  const ordered = orderSources(sources, leading, equiPreds, rangePreds, config);

  if (ordered[0].hint) {
    ordered[0] = { ...ordered[0], hint: undefined };
  }

  let tree: JoinNode = { kind: "leaf", source: ordered[0] };
  let accRows = estimatedRows(ordered[0]);
  let accWidth = estimatedWidth(ordered[0]);
  let accNdv = getNodeNdv(tree);
  let accMcv = getNodeMcv(tree);
  let accStatsSource = ordered[0].stats?.statsSource;

  for (let i = 1; i < ordered.length; i++) {
    const right = ordered[i];
    const jt = right.hint?.joinType ?? "inner";
    const leftNames = collectSourceNames(tree);

    const { selectivity, equiPred, outputRows, trace } =
      estimateJoinWithCandidate(
        leftNames,
        accRows,
        accNdv,
        accMcv,
        right,
        equiPreds,
        rangePreds,
        jt,
        accStatsSource,
        config,
      );

    let method = selectPhysicalOperator(
      accRows,
      right,
      jt,
      !!equiPred,
      accWidth,
      config,
    );

    if (!equiPred && method !== "loop") {
      method = "loop";
    }

    const joinNdv = propagateJoinNdv(
      accNdv,
      right.stats?.ndv ?? new Map(),
      right.name,
      jt,
      equiPred,
      outputRows,
    );

    const joinMcv = propagateJoinMcv(
      accMcv,
      right.stats?.mcv,
      right.name,
      jt,
      equiPred,
      accNdv,
      right.stats?.ndv ?? new Map(),
    );

    const joinStatsSource = summarizeJoinStatsSource(
      accStatsSource,
      right.stats?.statsSource,
    );

    tree = {
      kind: "join",
      left: tree,
      right: { kind: "leaf", source: right },
      method,
      joinType: jt,
      equiPred,
      estimatedSelectivity: selectivity,
      estimatedRows: outputRows,
      estimatedNdv: joinNdv,
      estimatedMcv: joinMcv,
      statsSource: joinStatsSource,
      selectivityTrace: trace,
    };

    accRows = outputRows;
    accWidth += estimatedWidth(right);
    accNdv = joinNdv;
    accMcv = joinMcv;
    accStatsSource =
      joinStatsSource === "exact"
        ? "persisted-complete"
        : joinStatsSource === "partial"
          ? "persisted-partial"
          : joinStatsSource === "approximate"
            ? "computed-sketch-large"
            : undefined;
  }

  if (residualWhere) {
    assignResidualPredicatesToLowestCoveringJoin(
      tree,
      residualWhere,
      equiPreds,
    );
  }

  return tree;
}

function orderSources(
  sources: JoinSource[],
  leading?: string[],
  equiPreds?: EquiPredicate[],
  rangePreds?: RangePredicate[],
  config?: JoinPlannerConfig,
): JoinSource[] {
  const hasExplicitJoinHint = sources.some((s) => !!s.hint);
  if (!leading?.length && hasExplicitJoinHint) {
    return [...sources];
  }

  if (!leading?.length && shouldAvoidAggressiveReordering(sources)) {
    return [...sources];
  }

  const byName = new Map(sources.map((s) => [s.name, s]));
  const ordered: JoinSource[] = [];

  if (leading && leading.length > 0) {
    for (const n of leading) {
      const s = byName.get(n);
      if (!s) {
        throw new Error(`unknown source '${n}' in 'leading' clause`);
      }
      ordered.push(s);
      byName.delete(n);
    }
  }

  const remaining = [...byName.values()];

  if (ordered.length === 0) {
    remaining.sort((a, b) => estimatedRows(a) - estimatedRows(b));
    ordered.push(remaining.shift()!);
  }

  let joinedNames = new Set<string>([ordered[0].name]);
  let joinedRows = estimatedRows(ordered[0]);
  let joinedWidth = estimatedWidth(ordered[0]);
  let joinedNdv = getNodeNdv({ kind: "leaf", source: ordered[0] });
  let joinedMcv = getNodeMcv({ kind: "leaf", source: ordered[0] });
  let joinedStatsSource = ordered[0].stats?.statsSource;

  const advanceJoinedState = (candidate: JoinSource) => {
    const joinType = candidate.hint?.joinType ?? "inner";

    const { equiPred, outputRows } = estimateJoinWithCandidate(
      joinedNames,
      joinedRows,
      joinedNdv,
      joinedMcv,
      candidate,
      equiPreds,
      rangePreds,
      joinType,
      joinedStatsSource,
      config,
    );

    joinedRows = outputRows;
    joinedWidth += estimatedWidth(candidate);
    joinedNdv = propagateJoinNdv(
      joinedNdv,
      candidate.stats?.ndv ?? new Map(),
      candidate.name,
      joinType,
      equiPred,
      outputRows,
    );
    joinedMcv = propagateJoinMcv(
      joinedMcv,
      candidate.stats?.mcv,
      candidate.name,
      joinType,
      equiPred,
      joinedNdv,
      candidate.stats?.ndv ?? new Map(),
    );

    const nextSummary = summarizeJoinStatsSource(
      joinedStatsSource,
      candidate.stats?.statsSource,
    );
    joinedStatsSource =
      nextSummary === "exact"
        ? "persisted-complete"
        : nextSummary === "partial"
          ? "persisted-partial"
          : nextSummary === "approximate"
            ? "computed-sketch-large"
            : undefined;

    joinedNames = new Set([...joinedNames, candidate.name]);
  };

  for (let i = 1; i < ordered.length; i++) {
    advanceJoinedState(ordered[i]);
  }

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestCost = Infinity;
    let bestOutRows = Infinity;
    let bestCandidateWidth = Infinity;
    let bestNextNdv = joinedNdv;
    let bestNextMcv = joinedMcv;
    let bestNextStatsSource = joinedStatsSource;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const joinType = candidate.hint?.joinType ?? "inner";

      const { equiPred, outputRows } = estimateJoinWithCandidate(
        joinedNames,
        joinedRows,
        joinedNdv,
        joinedMcv,
        candidate,
        equiPreds,
        rangePreds,
        joinType,
        joinedStatsSource,
        config,
      );

      const candidateWidth = clampWidth(estimatedWidth(candidate));
      const candidatePenalty = executionScanPenalty(candidate, config);

      const cost =
        (outputRows + estimatedSourceCost(candidate)) *
        candidatePenalty *
        (getWidthWeight(config) * clampWidth(joinedWidth) +
          getCandidateWidthWeight(config) * candidateWidth);

      if (
        cost < bestCost ||
        (cost === bestCost && outputRows < bestOutRows) ||
        (cost === bestCost &&
          outputRows === bestOutRows &&
          candidateWidth < bestCandidateWidth)
      ) {
        bestCost = cost;
        bestOutRows = outputRows;
        bestCandidateWidth = candidateWidth;
        bestIdx = i;
        bestNextNdv = propagateJoinNdv(
          joinedNdv,
          candidate.stats?.ndv ?? new Map(),
          candidate.name,
          joinType,
          equiPred,
          outputRows,
        );
        bestNextMcv = propagateJoinMcv(
          joinedMcv,
          candidate.stats?.mcv,
          candidate.name,
          joinType,
          equiPred,
          joinedNdv,
          candidate.stats?.ndv ?? new Map(),
        );
        const nextSummary = summarizeJoinStatsSource(
          joinedStatsSource,
          candidate.stats?.statsSource,
        );
        bestNextStatsSource =
          nextSummary === "exact"
            ? "persisted-complete"
            : nextSummary === "partial"
              ? "persisted-partial"
              : nextSummary === "approximate"
                ? "computed-sketch-large"
                : undefined;
      }
    }

    const chosen = remaining.splice(bestIdx, 1)[0];
    ordered.push(chosen);
    joinedNames = new Set([...joinedNames, chosen.name]);
    joinedRows = bestOutRows;
    joinedWidth += estimatedWidth(chosen);
    joinedNdv = bestNextNdv;
    joinedMcv = bestNextMcv;
    joinedStatsSource = bestNextStatsSource;
  }

  return ordered;
}

function executionScanPenalty(
  source: JoinSource,
  config?: JoinPlannerConfig,
): number {
  const primary = collectionPrimaryEngine(source.stats);
  if (!primary) return 1.0;

  const hasWherePushdown = collectionHasPlannerCapability(
    source.stats,
    "stage-where",
  );
  const hasBitmapScan = collectionHasPlannerCapability(
    source.stats,
    "scan-bitmap",
  );
  const hasIndexScan = collectionHasPlannerCapability(
    source.stats,
    "scan-index",
  );
  const hasKvScan = collectionHasPlannerCapability(source.stats, "scan-kv");

  let penalty = primary.baseCostWeight ?? 1.0;

  if (hasBitmapScan && hasWherePushdown) {
    penalty *= getBitmapScanPenalty(config);
  } else if (hasIndexScan && !hasWherePushdown) {
    penalty *= getIndexScanNoPushdownPenalty(config);
  } else if (hasKvScan) {
    penalty *= getKvScanPenalty(config);
  }

  return penalty;
}

function selectPhysicalOperator(
  leftRowCount: number,
  right: JoinSource,
  joinType: JoinType = "inner",
  hasEquiPred: boolean = false,
  leftWidth: number = DEFAULT_ESTIMATED_WIDTH,
  config?: JoinPlannerConfig,
): "hash" | "loop" | "merge" {
  if (right.hint) {
    const k = right.hint.kind;
    if (k === "merge") {
      if (!hasEquiPred) {
        throw new Error("'merge' join requires an equality predicate");
      }
      return "merge";
    }
    if (k === "hash") {
      if (right.hint.using) {
        throw new Error("'using' only valid with 'loop' hint");
      }
      return "hash";
    }
    if (k === "loop") return "loop";
  }

  const rr = right.stats?.rowCount ?? DEFAULT_ESTIMATED_ROWS;
  const rw = clampWidth(estimatedWidth(right));
  const lw = clampWidth(leftWidth);

  if (rr <= getSmallTableThreshold(config)) {
    if (
      (joinType === "semi" || joinType === "anti") &&
      hasEquiPred &&
      !right.hint?.using
    ) {
      return "hash";
    }
    return "loop";
  }

  const hashCost = computeJoinCost(
    "hash",
    joinType,
    0,
    leftRowCount,
    lw,
    0,
    rr,
    rw,
    config,
  ).totalCost;

  const nljCost = computeJoinCost(
    "loop",
    joinType,
    0,
    leftRowCount,
    lw,
    0,
    rr,
    rw,
    config,
  ).totalCost;

  if (
    hasEquiPred &&
    leftRowCount > getMergeJoinThreshold(config) &&
    rr > getMergeJoinThreshold(config)
  ) {
    const mergeCost = computeJoinCost(
      "merge",
      joinType,
      0,
      leftRowCount,
      lw,
      0,
      rr,
      rw,
      config,
    ).totalCost;
    if (mergeCost < hashCost && mergeCost < nljCost) {
      return "merge";
    }
  }

  return hashCost < nljCost ? "hash" : "loop";
}

async function cooperativeYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function materializeSource(
  source: JoinSource,
  env: LuaEnv,
  sf: LuaStackFrame,
  overrides?: MaterializedSourceOverrides,
): Promise<any[]> {
  const overridden = overrides?.get(source.name);
  if (overridden) {
    return overridden;
  }
  const val = await evalExpression(source.expression, env, sf);
  if (val === null || val === undefined) {
    throw new LuaRuntimeError(
      `'from' clause source "${source.name}" is null`,
      sf.withCtx(source.expression.ctx),
    );
  }
  if (Array.isArray(val)) return val;
  if (val instanceof LuaTable) return luaTableToArray(val);
  if (
    typeof val === "object" &&
    val !== null &&
    "query" in val &&
    typeof (val as any).query === "function"
  ) {
    return val.query({}, env, sf);
  }
  return [val];
}

function rowToTable(name: string, item: any): LuaTable {
  const row = new LuaTable();
  void row.rawSet(name, item);
  return row;
}

function cloneRow(src: LuaTable): LuaTable {
  const dst = new LuaTable();
  for (const k of luaKeys(src)) {
    void dst.rawSet(k, src.rawGet(k));
  }
  return dst;
}

function sortKey(item: any): string | number {
  if (item === null || item === undefined) return "";
  if (typeof item === "string") return item;
  if (typeof item === "number") return item;
  if (typeof item === "boolean") return item ? 1 : 0;
  if (item instanceof LuaTable) {
    const parts: string[] = [];
    for (const k of luaKeys(item)) {
      const v = item.rawGet(k);
      parts.push(`${k}:${v ?? ""}`);
    }
    parts.sort();
    return parts.join("|");
  }
  return String(item);
}

function compareSortKeys(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function extractField(obj: any, column: string): any {
  if (obj === null || obj === undefined) return null;
  if (obj instanceof LuaTable) return obj.rawGet(column);
  if (typeof obj === "object") return obj[column];
  return null;
}

function hashJoinKey(item: any): string | null {
  if (item === null || item === undefined) return null;
  if (typeof item === "string") return `s:${item}`;
  if (typeof item === "number") {
    return Object.is(item, -0) ? "n:-0" : `n:${item}`;
  }
  if (typeof item === "boolean") {
    return item ? "b:1" : "b:0";
  }
  return null;
}

function normalizeEquiPredicateForJoin(
  equiPred: EquiPredicate,
  leftNode: JoinNode,
  rightSource: JoinSource,
): EquiPredicate {
  const leftNames = collectSourceNames(leftNode);
  const rightName = rightSource.name;

  if (
    leftNames.has(equiPred.leftSource) &&
    equiPred.rightSource === rightName
  ) {
    return equiPred;
  }

  if (
    leftNames.has(equiPred.rightSource) &&
    equiPred.leftSource === rightName
  ) {
    return {
      leftSource: equiPred.rightSource,
      leftColumn: equiPred.rightColumn,
      rightSource: equiPred.leftSource,
      rightColumn: equiPred.leftColumn,
    };
  }

  throw new Error(
    `equality predicate does not match 'join' sides: left={${[...leftNames].join(",")}} right=${rightName}`,
  );
}

function resolveUsingPredicate(
  hint: LuaJoinHint | undefined,
  env: LuaEnv,
  sf: LuaStackFrame,
): LuaValue | null {
  if (!hint || hint.kind !== "loop" || !hint.using) return null;
  if (typeof hint.using === "string") {
    const fn = env.get(hint.using);
    if (!fn) {
      throw new LuaRuntimeError(
        `'using' predicate "${hint.using}" is not defined`,
        sf,
      );
    }
    return fn;
  }
  return new LuaFunction(hint.using as LuaFunctionBody, env);
}

function isLeafNode(node: JoinNode): node is JoinLeaf {
  return node.kind === "leaf";
}

function loopPredicateLeftArg(leftNode: JoinNode, row: LuaTable): LuaValue {
  if (isLeafNode(leftNode)) {
    return row.rawGet(leftNode.source.name);
  }

  const keys = [...luaKeys(row)];
  if (keys.length === 1) {
    return row.rawGet(keys[0]);
  }

  return row;
}

async function evaluateJoinResiduals(
  leftRow: LuaTable,
  rightName: string,
  rightItem: any,
  residuals: LuaExpression[] | undefined,
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<boolean> {
  if (!residuals || residuals.length === 0) return true;

  const rowEnv = new LuaEnv(env);
  for (const k of luaKeys(leftRow)) {
    rowEnv.setLocal(String(k), leftRow.rawGet(k));
  }
  rowEnv.setLocal(rightName, rightItem);

  for (const residual of residuals) {
    const val = await evalExpression(residual, rowEnv, sf);
    if (!luaTruthy(val)) {
      return false;
    }
  }
  return true;
}

async function hashSemiAntiJoin(
  leftRows: LuaTable[],
  rightItems: any[],
  joinType: "semi" | "anti",
  equiPred: EquiPredicate,
  rightName: string,
  residuals: LuaExpression[] | undefined,
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<LuaTable[]> {
  const buildMap = new Map<string, any[]>();
  for (const rItem of rightItems) {
    const val = extractField(rItem, equiPred.rightColumn);
    const key = hashJoinKey(val);
    if (key === null) continue;
    let bucket = buildMap.get(key);
    if (!bucket) {
      bucket = [];
      buildMap.set(key, bucket);
    }
    bucket.push(rItem);
  }

  const results: LuaTable[] = [];
  for (const lRow of leftRows) {
    const leftObj = lRow.rawGet(equiPred.leftSource);
    const val = extractField(leftObj, equiPred.leftColumn);
    const key = hashJoinKey(val);

    let found = false;
    if (key !== null) {
      const bucket = buildMap.get(key) ?? [];
      for (const rItem of bucket) {
        if (
          await evaluateJoinResiduals(
            lRow,
            rightName,
            rItem,
            residuals,
            env,
            sf,
          )
        ) {
          found = true;
          break;
        }
      }
    }

    if (joinType === "semi" && found) results.push(lRow);
    else if (joinType === "anti" && !found) results.push(lRow);
  }
  return results;
}

async function nestedLoopSemiAntiJoin(
  leftRows: LuaTable[],
  rightItems: any[],
  leftNode: JoinNode,
  predicate: LuaValue,
  joinType: "semi" | "anti",
  rightName: string,
  residuals: LuaExpression[] | undefined,
  env: LuaEnv,
  sf: LuaStackFrame,
  equiPred?: EquiPredicate,
): Promise<LuaTable[]> {
  const results: LuaTable[] = [];
  for (const leftRow of leftRows) {
    if (equiPred) {
      const leftObj = leftRow.rawGet(equiPred.leftSource);
      const val = extractField(leftObj, equiPred.leftColumn);
      const key = hashJoinKey(val);
      if (key === null) {
        if (joinType === "anti") results.push(leftRow);
        continue;
      }
    }

    const leftArg = loopPredicateLeftArg(leftNode, leftRow);
    let found = false;
    for (const rightItem of rightItems) {
      const res = singleResult(
        await luaCall(predicate, [leftArg, rightItem], sf.astCtx ?? {}, sf),
      );
      if (!luaTruthy(res)) continue;
      if (
        !(await evaluateJoinResiduals(
          leftRow,
          rightName,
          rightItem,
          residuals,
          env,
          sf,
        ))
      ) {
        continue;
      }
      found = true;
      break;
    }
    if (joinType === "semi" && found) results.push(leftRow);
    else if (joinType === "anti" && !found) results.push(leftRow);
  }
  return results;
}

async function residualLoopJoin(
  leftRows: LuaTable[],
  rightItems: any[],
  rightName: string,
  residuals: LuaExpression[],
  env: LuaEnv,
  sf: LuaStackFrame,
  config?: JoinPlannerConfig,
): Promise<LuaTable[]> {
  const limit = getWatchdogLimit(config);
  const chunk = getYieldChunk(config);
  const results: LuaTable[] = [];
  let processed = 0;

  for (const leftRow of leftRows) {
    for (const rightItem of rightItems) {
      if (
        !(await evaluateJoinResiduals(
          leftRow,
          rightName,
          rightItem,
          residuals,
          env,
          sf,
        ))
      ) {
        continue;
      }

      if (++processed > limit) {
        throw new LuaRuntimeError(
          `intermediate join result exceeded row limit (${limit} rows)`,
          sf,
        );
      }

      const newRow = cloneRow(leftRow);
      void newRow.rawSet(rightName, rightItem);
      results.push(newRow);

      if (processed % chunk === 0) {
        await cooperativeYield();
      }
    }
  }

  return results;
}

async function crossJoin(
  leftRows: LuaTable[],
  rightItems: any[],
  rightName: string,
  sf: LuaStackFrame,
  config?: JoinPlannerConfig,
): Promise<LuaTable[]> {
  const limit = getWatchdogLimit(config);
  const chunk = getYieldChunk(config);
  const results: LuaTable[] = [];
  let processed = 0;
  for (const leftRow of leftRows) {
    for (const rightItem of rightItems) {
      if (++processed > limit) {
        throw new LuaRuntimeError(
          `intermediate join result exceeded row limit (${limit} rows)`,
          sf,
        );
      }
      const newRow = cloneRow(leftRow);
      void newRow.rawSet(rightName, rightItem);
      results.push(newRow);
      if (processed % chunk === 0) await cooperativeYield();
    }
  }
  return results;
}

// Hash build side: prefer smaller input (same row shape either way).
type HashBuildSide = "left" | "right";

function pickHashBuildSide(
  leftRowCount: number,
  rightItemCount: number,
): HashBuildSide {
  return leftRowCount < rightItemCount ? "left" : "right";
}

async function hashInnerJoin(
  leftRows: LuaTable[],
  rightItems: any[],
  rightName: string,
  equiPred: EquiPredicate,
  residuals: LuaExpression[] | undefined,
  env: LuaEnv,
  sf: LuaStackFrame,
  config?: JoinPlannerConfig,
): Promise<LuaTable[]> {
  const limit = getWatchdogLimit(config);
  const chunk = getYieldChunk(config);

  const buildSide = pickHashBuildSide(leftRows.length, rightItems.length);

  if (buildSide === "left") {
    const buildMap = new Map<string, LuaTable[]>();
    for (const lRow of leftRows) {
      const leftObj = lRow.rawGet(equiPred.leftSource);
      const val = extractField(leftObj, equiPred.leftColumn);
      const key = hashJoinKey(val);
      if (key === null) continue;
      let bucket = buildMap.get(key);
      if (!bucket) {
        bucket = [];
        buildMap.set(key, bucket);
      }
      bucket.push(lRow);
    }

    const results: LuaTable[] = [];
    let processed = 0;
    for (const rItem of rightItems) {
      const val = extractField(rItem, equiPred.rightColumn);
      const key = hashJoinKey(val);
      if (key === null) continue;
      const bucket = buildMap.get(key);
      if (!bucket) continue;
      for (const lRow of bucket) {
        if (
          !(await evaluateJoinResiduals(
            lRow,
            rightName,
            rItem,
            residuals,
            env,
            sf,
          ))
        ) {
          continue;
        }
        if (++processed > limit) {
          throw new LuaRuntimeError(
            `intermediate join result exceeded row limit (${limit} rows)`,
            sf,
          );
        }
        const newRow = cloneRow(lRow);
        void newRow.rawSet(rightName, rItem);
        results.push(newRow);
        if (processed % chunk === 0) await cooperativeYield();
      }
    }
    return results;
  }

  const buildMap = new Map<string, any[]>();
  for (const rItem of rightItems) {
    const val = extractField(rItem, equiPred.rightColumn);
    const key = hashJoinKey(val);
    if (key === null) continue;
    let bucket = buildMap.get(key);
    if (!bucket) {
      bucket = [];
      buildMap.set(key, bucket);
    }
    bucket.push(rItem);
  }

  const results: LuaTable[] = [];
  let processed = 0;
  for (const lRow of leftRows) {
    const leftObj = lRow.rawGet(equiPred.leftSource);
    const val = extractField(leftObj, equiPred.leftColumn);
    const key = hashJoinKey(val);
    if (key === null) continue;
    const bucket = buildMap.get(key);
    if (!bucket) continue;
    for (const rItem of bucket) {
      if (
        !(await evaluateJoinResiduals(
          lRow,
          rightName,
          rItem,
          residuals,
          env,
          sf,
        ))
      ) {
        continue;
      }
      if (++processed > limit) {
        throw new LuaRuntimeError(
          `intermediate join result exceeded row limit (${limit} rows)`,
          sf,
        );
      }
      const newRow = cloneRow(lRow);
      void newRow.rawSet(rightName, rItem);
      results.push(newRow);
      if (processed % chunk === 0) await cooperativeYield();
    }
  }
  return results;
}

async function nestedLoopEquiJoin(
  leftRows: LuaTable[],
  rightItems: any[],
  rightName: string,
  equiPred: EquiPredicate,
  residuals: LuaExpression[] | undefined,
  env: LuaEnv,
  sf: LuaStackFrame,
  config?: JoinPlannerConfig,
): Promise<LuaTable[]> {
  const limit = getWatchdogLimit(config);
  const chunk = getYieldChunk(config);
  const results: LuaTable[] = [];
  let processed = 0;

  for (const lRow of leftRows) {
    const leftObj = lRow.rawGet(equiPred.leftSource);
    const leftVal = extractField(leftObj, equiPred.leftColumn);
    const leftKey = hashJoinKey(leftVal);
    if (leftKey === null) continue;

    for (const rightItem of rightItems) {
      const rightVal = extractField(rightItem, equiPred.rightColumn);
      const rightKey = hashJoinKey(rightVal);
      if (rightKey === null) continue;
      if (leftKey !== rightKey) continue;
      if (
        !(await evaluateJoinResiduals(
          lRow,
          rightName,
          rightItem,
          residuals,
          env,
          sf,
        ))
      ) {
        continue;
      }

      if (++processed > limit) {
        throw new LuaRuntimeError(
          `intermediate join result exceeded row limit (${limit} rows)`,
          sf,
        );
      }

      const newRow = cloneRow(lRow);
      void newRow.rawSet(rightName, rightItem);
      results.push(newRow);

      if (processed % chunk === 0) {
        await cooperativeYield();
      }
    }
  }

  return results;
}

async function predicateLoopJoin(
  leftRows: LuaTable[],
  rightItems: any[],
  rightName: string,
  leftNode: JoinNode,
  predicate: LuaValue,
  residuals: LuaExpression[] | undefined,
  env: LuaEnv,
  sf: LuaStackFrame,
  config?: JoinPlannerConfig,
): Promise<LuaTable[]> {
  const limit = getWatchdogLimit(config);
  const chunk = getYieldChunk(config);
  const results: LuaTable[] = [];
  let processed = 0;
  for (const leftRow of leftRows) {
    const leftArg = loopPredicateLeftArg(leftNode, leftRow);
    for (const rightItem of rightItems) {
      const res = singleResult(
        await luaCall(predicate, [leftArg, rightItem], sf.astCtx ?? {}, sf),
      );
      if (!luaTruthy(res)) continue;
      if (
        !(await evaluateJoinResiduals(
          leftRow,
          rightName,
          rightItem,
          residuals,
          env,
          sf,
        ))
      ) {
        continue;
      }
      if (++processed > limit) {
        throw new LuaRuntimeError(
          `intermediate join result exceeded row limit (${limit} rows)`,
          sf,
        );
      }
      const newRow = cloneRow(leftRow);
      void newRow.rawSet(rightName, rightItem);
      results.push(newRow);
      if (processed % chunk === 0) await cooperativeYield();
    }
  }
  return results;
}

async function sortMergeJoin(
  leftRows: LuaTable[],
  rightItems: any[],
  rightName: string,
  residuals: LuaExpression[] | undefined,
  env: LuaEnv,
  sf: LuaStackFrame,
  config?: JoinPlannerConfig,
  equiPred?: EquiPredicate,
): Promise<LuaTable[]> {
  const limit = getWatchdogLimit(config);
  const chunk = getYieldChunk(config);

  const leftKeyFn = equiPred
    ? (row: LuaTable) => {
        const obj = row.rawGet(equiPred.leftSource);
        return sortKey(extractField(obj, equiPred.leftColumn));
      }
    : (row: LuaTable) => {
        let key: string | number = "";
        for (const k of luaKeys(row)) {
          key = sortKey(row.rawGet(k));
          break;
        }
        return key;
      };

  const rightKeyFn = equiPred
    ? (item: any) => sortKey(extractField(item, equiPred.rightColumn))
    : (item: any) => sortKey(item);

  const leftKeyed = leftRows.map((row) => ({ row, key: leftKeyFn(row) }));
  const rightKeyed = rightItems.map((item) => ({
    item,
    key: rightKeyFn(item),
  }));

  leftKeyed.sort((a, b) => compareSortKeys(a.key, b.key));
  rightKeyed.sort((a, b) => compareSortKeys(a.key, b.key));

  let leftStart = 0;
  let rightStart = 0;

  if (equiPred) {
    while (
      leftStart < leftKeyed.length &&
      hashJoinKey(
        extractField(
          leftKeyed[leftStart].row.rawGet(equiPred.leftSource),
          equiPred.leftColumn,
        ),
      ) === null
    ) {
      leftStart++;
    }
    while (
      rightStart < rightKeyed.length &&
      hashJoinKey(
        extractField(rightKeyed[rightStart].item, equiPred.rightColumn),
      ) === null
    ) {
      rightStart++;
    }
  }

  const results: LuaTable[] = [];
  let processed = 0;
  let li = leftStart;
  let ri = rightStart;

  while (li < leftKeyed.length && ri < rightKeyed.length) {
    const cmp = compareSortKeys(leftKeyed[li].key, rightKeyed[ri].key);
    if (cmp < 0) {
      li++;
      continue;
    }
    if (cmp > 0) {
      ri++;
      continue;
    }

    const matchKey = leftKeyed[li].key;
    const leftGroup: LuaTable[] = [];
    while (
      li < leftKeyed.length &&
      compareSortKeys(leftKeyed[li].key, matchKey) === 0
    ) {
      leftGroup.push(leftKeyed[li].row);
      li++;
    }

    const rightGroup: any[] = [];
    while (
      ri < rightKeyed.length &&
      compareSortKeys(rightKeyed[ri].key, matchKey) === 0
    ) {
      rightGroup.push(rightKeyed[ri].item);
      ri++;
    }

    for (const leftRow of leftGroup) {
      for (const rightItem of rightGroup) {
        if (
          !(await evaluateJoinResiduals(
            leftRow,
            rightName,
            rightItem,
            residuals,
            env,
            sf,
          ))
        ) {
          continue;
        }
        if (++processed > limit) {
          throw new LuaRuntimeError(
            `intermediate join result exceeded row limit (${limit} rows)`,
            sf,
          );
        }
        const newRow = cloneRow(leftRow);
        void newRow.rawSet(rightName, rightItem);
        results.push(newRow);
        if (processed % chunk === 0) await cooperativeYield();
      }
    }
  }
  return results;
}

async function dispatchJoin(
  tree: JoinInner,
  leftRows: LuaTable[],
  rightItems: any[],
  rightSource: JoinSource,
  env: LuaEnv,
  sf: LuaStackFrame,
  config?: JoinPlannerConfig,
): Promise<LuaTable[]> {
  const rightName = rightSource.name;
  const joinType = tree.joinType ?? "inner";
  const predicate = resolveUsingPredicate(rightSource.hint, env, sf);
  const equiPred = tree.equiPred
    ? normalizeEquiPredicateForJoin(tree.equiPred, tree.left, rightSource)
    : undefined;
  const residuals = tree.joinResiduals;

  if (joinType === "semi" || joinType === "anti") {
    if (tree.method === "loop") {
      if (!predicate) {
        throw new LuaRuntimeError(
          `'${joinType}' join with 'loop' method requires 'using' predicate`,
          sf,
        );
      }
      return nestedLoopSemiAntiJoin(
        leftRows,
        rightItems,
        tree.left,
        predicate,
        joinType,
        rightName,
        residuals,
        env,
        sf,
        equiPred,
      );
    }

    if (equiPred) {
      return hashSemiAntiJoin(
        leftRows,
        rightItems,
        joinType,
        equiPred,
        rightName,
        residuals,
        env,
        sf,
      );
    }

    throw new LuaRuntimeError(
      `'${joinType}' join requires an equality join predicate or a 'loop' join with 'using'`,
      sf,
    );
  }

  if (tree.method === "loop" && predicate) {
    return predicateLoopJoin(
      leftRows,
      rightItems,
      rightName,
      tree.left,
      predicate,
      residuals,
      env,
      sf,
      config,
    );
  }

  if (equiPred) {
    switch (tree.method) {
      case "hash":
        return hashInnerJoin(
          leftRows,
          rightItems,
          rightName,
          equiPred,
          residuals,
          env,
          sf,
          config,
        );
      case "merge":
        return sortMergeJoin(
          leftRows,
          rightItems,
          rightName,
          residuals,
          env,
          sf,
          config,
          equiPred,
        );
      case "loop":
        return nestedLoopEquiJoin(
          leftRows,
          rightItems,
          rightName,
          equiPred,
          residuals,
          env,
          sf,
          config,
        );
    }
  }

  if (residuals && residuals.length > 0) {
    return residualLoopJoin(
      leftRows,
      rightItems,
      rightName,
      residuals,
      env,
      sf,
      config,
    );
  }

  return crossJoin(leftRows, rightItems, rightName, sf, config);
}

export async function executeJoinTree(
  tree: JoinNode,
  env: LuaEnv,
  sf: LuaStackFrame,
  config?: JoinPlannerConfig,
  overrides?: MaterializedSourceOverrides,
): Promise<LuaTable[]> {
  if (tree.kind === "leaf") {
    const items = await materializeSource(tree.source, env, sf, overrides);
    return items.map((item) => rowToTable(tree.source.name, item));
  }
  const leftRows = await executeJoinTree(tree.left, env, sf, config, overrides);
  if (tree.right.kind !== "leaf") {
    throw new Error(
      "join planner: right child must be a leaf (left-deep trees only)",
    );
  }
  const rightSource = tree.right.source;
  const rightItems = await materializeSource(rightSource, env, sf, overrides);
  return dispatchJoin(tree, leftRows, rightItems, rightSource, env, sf, config);
}

export function extractEquiPredicates(
  expr: LuaExpression | undefined,
  sourceNames: Set<string>,
): EquiPredicate[] {
  if (!expr) return [];
  const result: EquiPredicate[] = [];
  collectEquiJoins(expr, sourceNames, result);
  return result;
}

function collectEquiJoins(
  expr: LuaExpression,
  sourceNames: Set<string>,
  out: EquiPredicate[],
): void {
  if (expr.type !== "Binary") return;
  if (expr.operator === "and") {
    collectEquiJoins(expr.left, sourceNames, out);
    collectEquiJoins(expr.right, sourceNames, out);
    return;
  }
  if (expr.operator === "==") {
    const left = parseSourceColumn(expr.left, sourceNames);
    const right = parseSourceColumn(expr.right, sourceNames);
    if (left && right && left.source !== right.source) {
      out.push({
        leftSource: left.source,
        leftColumn: left.column,
        rightSource: right.source,
        rightColumn: right.column,
      });
    }
  }
}

export function extractRangePredicates(
  expr: LuaExpression | undefined,
  sourceNames: Set<string>,
): RangePredicate[] {
  if (!expr) return [];
  const result: RangePredicate[] = [];
  collectRangeJoins(expr, sourceNames, result);
  return result;
}

function collectRangeJoins(
  expr: LuaExpression,
  sourceNames: Set<string>,
  out: RangePredicate[],
): void {
  if (expr.type !== "Binary") return;
  if (expr.operator === "and") {
    collectRangeJoins(expr.left, sourceNames, out);
    collectRangeJoins(expr.right, sourceNames, out);
    return;
  }
  const op = expr.operator;
  if (op === ">" || op === "<" || op === ">=" || op === "<=") {
    const left = parseSourceColumn(expr.left, sourceNames);
    const right = parseSourceColumn(expr.right, sourceNames);
    if (left && right && left.source !== right.source) {
      out.push({
        leftSource: left.source,
        leftColumn: left.column,
        operator: op as RangePredicate["operator"],
        rightSource: right.source,
        rightColumn: right.column,
      });
    }
  }
}

function parseSourceColumn(
  expr: LuaExpression,
  sourceNames: Set<string>,
): { source: string; column: string } | null {
  if (expr.type !== "PropertyAccess") return null;
  if (expr.object.type !== "Variable") return null;
  const source = expr.object.name;
  if (!sourceNames.has(source)) return null;
  return { source, column: expr.property };
}

type SourceColumnRef = {
  source: string;
  column: string;
};

function parseGroupKeySourceColumn(
  expr: LuaExpression,
): SourceColumnRef | null {
  if (expr.type === "PropertyAccess" && expr.object.type === "Variable") {
    return {
      source: expr.object.name,
      column: expr.property,
    };
  }
  if (expr.type === "Variable") {
    return {
      source: "",
      column: expr.name,
    };
  }
  return null;
}

export type SingleSourceFilter = {
  sourceName: string;
  expression: LuaExpression;
};

export function extractSingleSourceFilters(
  expr: LuaExpression | undefined,
  sourceNames: Set<string>,
): { pushed: SingleSourceFilter[]; residual: LuaExpression | undefined } {
  if (!expr) return { pushed: [], residual: undefined };

  const normalized = normalizePushdownExpression(expr);
  const pushed: SingleSourceFilter[] = [];
  const residualParts: LuaExpression[] = [];

  extractPushdownsFromExpr(normalized, sourceNames, pushed, residualParts);

  return {
    pushed,
    residual: rebuildAndExpression(residualParts),
  };
}

export function buildNormalizationInfoBySource(
  expr: LuaExpression | undefined,
  sourceNames: Set<string>,
): Map<string, SourceNormalizationInfo> {
  if (!expr) return new Map();

  const originalBySource = collectOriginalConjunctsBySource(expr, sourceNames);

  const normalized = normalizePushdownExpression(expr);

  const info = new Map<
    string,
    { pushed: LuaExpression[]; leftover: LuaExpression[] }
  >();
  collectNormalizationInfo(normalized, sourceNames, info);

  const result = new Map<string, SourceNormalizationInfo>();
  for (const [sourceName, parts] of info) {
    const pushedExpr = rebuildAndExpression(parts.pushed);
    const leftoverExpr = rebuildAndExpression(parts.leftover);
    if (!pushedExpr && !leftoverExpr) continue;

    const fullNormalizedExpr = rebuildAndExpression([
      ...parts.pushed,
      ...parts.leftover,
    ]);

    const originalConjuncts = originalBySource.get(sourceName) ?? [];
    const originalAndExpr = rebuildAndExpression(originalConjuncts);

    const fallbackDisplayExpr = pushedExpr ?? leftoverExpr!;

    result.set(sourceName, {
      state: leftoverExpr ? "partial" : "complete",
      originalExpr: originalAndExpr
        ? exprToDisplayString(originalAndExpr)
        : exprToDisplayString(fallbackDisplayExpr),
      normalizedExpr: fullNormalizedExpr
        ? exprToDisplayString(fullNormalizedExpr)
        : exprToDisplayString(fallbackDisplayExpr),
      pushdownExpr: pushedExpr ? exprToDisplayString(pushedExpr) : "none",
      leftoverExpr: leftoverExpr ? exprToDisplayString(leftoverExpr) : "none",
    });
  }

  return result;
}

function collectOriginalConjunctsBySource(
  expr: LuaExpression,
  sourceNames: Set<string>,
): Map<string, LuaExpression[]> {
  const out = new Map<string, LuaExpression[]>();
  const visit = (e: LuaExpression) => {
    if (e.type === "Binary" && e.operator === "and") {
      visit(e.left);
      visit(e.right);
      return;
    }
    const refs = collectReferencedSources(e, sourceNames);
    if (refs.size !== 1) return;
    const [sourceName] = refs;
    let arr = out.get(sourceName);
    if (!arr) {
      arr = [];
      out.set(sourceName, arr);
    }
    arr.push(e);
  };
  visit(expr);
  return out;
}

function collectNormalizationInfo(
  expr: LuaExpression,
  sourceNames: Set<string>,
  info: Map<string, { pushed: LuaExpression[]; leftover: LuaExpression[] }>,
): void {
  if (expr.type === "Binary" && expr.operator === "and") {
    collectNormalizationInfo(expr.left, sourceNames, info);
    collectNormalizationInfo(expr.right, sourceNames, info);
    return;
  }

  const refs = collectReferencedSources(expr, sourceNames);
  if (refs.size !== 1) return;

  const [sourceName] = refs;
  let entry = info.get(sourceName);
  if (!entry) {
    entry = { pushed: [], leftover: [] };
    info.set(sourceName, entry);
  }

  if (
    isExplicitlyScopedToSource(expr, sourceNames, sourceName) &&
    isPushdownSafeExpressionForSource(expr, sourceNames, sourceName)
  ) {
    entry.pushed.push(normalizePushdownExpression(expr));
  } else {
    entry.leftover.push(expr);
  }
}

function extractPushdownsFromExpr(
  expr: LuaExpression,
  sourceNames: Set<string>,
  pushed: SingleSourceFilter[],
  residualParts: LuaExpression[],
): void {
  const refs = collectReferencedSources(expr, sourceNames);

  if (refs.size === 1) {
    const [sourceName] = refs;
    if (
      isExplicitlyScopedToSource(expr, sourceNames, sourceName) &&
      isPushdownSafeExpressionForSource(expr, sourceNames, sourceName)
    ) {
      pushed.push({
        sourceName,
        expression: normalizePushdownExpression(expr),
      });
      return;
    }
  }

  if (expr.type === "Binary" && expr.operator === "and") {
    extractPushdownsFromExpr(expr.left, sourceNames, pushed, residualParts);
    extractPushdownsFromExpr(expr.right, sourceNames, pushed, residualParts);
    return;
  }

  residualParts.push(expr);
}

function isPushdownSafeExpressionForSource(
  expr: LuaExpression,
  sourceNames: Set<string>,
  targetSource: string,
): boolean {
  switch (expr.type) {
    case "Nil":
    case "Boolean":
    case "Number":
    case "String":
      return true;

    case "Variable":
      return expr.name === targetSource;

    case "PropertyAccess":
      if (
        expr.object.type === "Variable" &&
        sourceNames.has(expr.object.name)
      ) {
        return expr.object.name === targetSource;
      }
      return isPushdownSafeExpressionForSource(
        expr.object,
        sourceNames,
        targetSource,
      );

    case "Parenthesized":
      return isPushdownSafeExpressionForSource(
        expr.expression,
        sourceNames,
        targetSource,
      );

    case "Unary":
      return (
        expr.operator === "not" &&
        isPushdownSafeExpressionForSource(
          expr.argument,
          sourceNames,
          targetSource,
        )
      );

    case "Binary":
      switch (expr.operator) {
        case "and":
        case "or":
        case "==":
        case "~=":
        case "!=":
        case "<":
        case "<=":
        case ">":
        case ">=":
          return (
            isPushdownSafeExpressionForSource(
              expr.left,
              sourceNames,
              targetSource,
            ) &&
            isPushdownSafeExpressionForSource(
              expr.right,
              sourceNames,
              targetSource,
            )
          );
        default:
          return false;
      }

    case "QueryIn":
      return (
        isPushdownSafeExpressionForSource(
          expr.left,
          sourceNames,
          targetSource,
        ) &&
        isPushdownSafeExpressionForSource(expr.right, sourceNames, targetSource)
      );

    case "TableConstructor":
      return expr.fields.every((field) => {
        switch (field.type) {
          case "DynamicField":
            return (
              isPushdownSafeExpressionForSource(
                field.key,
                sourceNames,
                targetSource,
              ) &&
              isPushdownSafeExpressionForSource(
                field.value,
                sourceNames,
                targetSource,
              )
            );
          case "PropField":
          case "ExpressionField":
            return isPushdownSafeExpressionForSource(
              field.value,
              sourceNames,
              targetSource,
            );
          default:
            return false;
        }
      });

    default:
      return false;
  }
}

// Return literal RHS expressions for `e in { ... }` when the set is static.
function extractStaticInLiteralExpressions(
  right: LuaExpression,
): LuaExpression[] | undefined {
  if (right.type !== "TableConstructor") {
    return undefined;
  }
  const out: LuaExpression[] = [];
  for (const field of right.fields) {
    if (field.type === "ExpressionField") {
      if (!isLiteralExpr(field.value)) {
        return undefined;
      }
      out.push(field.value);
    } else if (field.type === "PropField") {
      if (!isLiteralExpr(field.value)) {
        return undefined;
      }
      out.push(field.value);
    } else {
      return undefined;
    }
  }
  return out;
}

export function normalizePushdownExpression(
  expr: LuaExpression,
): LuaExpression {
  switch (expr.type) {
    case "Parenthesized":
      return normalizePushdownExpression(expr.expression);

    case "Unary": {
      const normalizedArg = normalizePushdownExpression(expr.argument);
      if (expr.operator === "not") {
        return normalizeNegation({
          ...expr,
          argument: normalizedArg,
        } as LuaExpression);
      }
      return {
        ...expr,
        argument: normalizedArg,
      };
    }

    case "Binary": {
      const left = normalizePushdownExpression(expr.left);
      const right = normalizePushdownExpression(expr.right);

      if (expr.operator === "and") {
        const parts = dedupeExpressions([
          ...collectAndChain(left),
          ...collectAndChain(right),
        ]);
        return (
          rebuildAndExpression(parts) ?? {
            type: "Boolean",
            value: true,
            ctx: expr.ctx,
          }
        );
      }

      if (expr.operator === "or") {
        const parts = dedupeExpressions([
          ...collectOrChain(left),
          ...collectOrChain(right),
        ]);
        const rebuilt = rebuildOrExpression(parts);
        return normalizeSameColumnOrChain(
          rebuilt ?? {
            type: "Boolean",
            value: false,
            ctx: expr.ctx,
          },
        );
      }

      return normalizeBinaryComparison({
        ...expr,
        left,
        right,
      } as LuaExpression);
    }

    case "QueryIn": {
      const left = normalizePushdownExpression(expr.left);
      const right = normalizePushdownExpression(expr.right);
      return { ...expr, left, right };
    }

    default:
      return expr;
  }
}

function normalizeBinaryComparison(expr: LuaExpression): LuaExpression {
  if (expr.type !== "Binary") return expr;

  const op = expr.operator;
  if (
    op !== "==" &&
    op !== "~=" &&
    op !== "!=" &&
    op !== "<" &&
    op !== "<=" &&
    op !== ">" &&
    op !== ">="
  ) {
    return expr;
  }

  if (isLiteralExpr(expr.left) && isColumnRefExpr(expr.right)) {
    const flipped = flipOp(op);
    if (flipped) {
      return {
        ...expr,
        operator: flipped as typeof expr.operator,
        left: expr.right,
        right: expr.left,
      };
    }
  }

  return expr;
}

function normalizeNegation(expr: LuaExpression): LuaExpression {
  if (expr.type !== "Unary" || expr.operator !== "not") return expr;

  const arg = expr.argument;

  if (arg.type === "Parenthesized") {
    return normalizeNegation({
      ...expr,
      argument: arg.expression,
    } as LuaExpression);
  }

  if (arg.type === "Unary" && arg.operator === "not") {
    return normalizePushdownExpression(arg.argument);
  }

  if (arg.type === "QueryIn") {
    const literalExprs = extractStaticInLiteralExpressions(arg.right);
    if (literalExprs && literalExprs.length > 0) {
      const neqParts: LuaExpression[] = literalExprs.map(
        (litExpr) =>
          ({
            type: "Binary",
            operator: "~=",
            left: arg.left,
            right: litExpr,
            ctx: arg.ctx,
          }) as LuaExpression,
      );
      return normalizePushdownExpression(
        rebuildAndExpression(neqParts) ?? {
          type: "Boolean",
          value: true,
          ctx: arg.ctx,
        },
      );
    }
    return {
      ...expr,
      argument: normalizePushdownExpression(arg),
    };
  }

  if (arg.type === "Binary") {
    switch (arg.operator) {
      case "==":
        return normalizePushdownExpression({
          ...arg,
          operator: "!=",
        } as LuaExpression);
      case "!=":
      case "~=":
        return normalizePushdownExpression({
          ...arg,
          operator: "==",
        } as LuaExpression);
      case "<":
        return normalizePushdownExpression({
          ...arg,
          operator: ">=",
        } as LuaExpression);
      case "<=":
        return normalizePushdownExpression({
          ...arg,
          operator: ">",
        } as LuaExpression);
      case ">":
        return normalizePushdownExpression({
          ...arg,
          operator: "<=",
        } as LuaExpression);
      case ">=":
        return normalizePushdownExpression({
          ...arg,
          operator: "<",
        } as LuaExpression);
      default:
        return {
          ...expr,
          argument: normalizePushdownExpression(arg),
        };
    }
  }

  return {
    ...expr,
    argument: normalizePushdownExpression(arg),
  };
}

function normalizeSameColumnOrChain(expr: LuaExpression): LuaExpression {
  const set = extractSameColumnOrLiteralSet(expr);
  if (!set) return expr;

  const leftBase: LuaExpression = {
    type: "PropertyAccess",
    object: {
      type: "Variable",
      name: set.sourceName,
      ctx: expr.ctx,
    },
    property: set.column,
    ctx: expr.ctx,
  } as LuaExpression;

  const disjuncts = set.literals.map((literal) => ({
    type: "Binary" as const,
    operator: "==" as const,
    left: leftBase,
    right: literal,
    ctx: expr.ctx,
  }));

  return rebuildOrExpression(disjuncts) ?? expr;
}

function extractSameColumnOrLiteralSet(expr: LuaExpression): {
  sourceName: string;
  column: string;
  literals: LuaExpression[];
} | null {
  const parts = collectOrChain(expr);
  if (parts.length < 2) return null;

  let sourceName: string | undefined;
  let column: string | undefined;
  const literals: LuaExpression[] = [];

  for (const part of parts) {
    if (part.type !== "Binary" || part.operator !== "==") {
      return null;
    }

    const normalized = normalizeBinaryComparison(part);
    if (normalized.type !== "Binary" || normalized.operator !== "==") {
      return null;
    }

    if (
      normalized.left.type !== "PropertyAccess" ||
      normalized.left.object.type !== "Variable" ||
      !isLiteralExpr(normalized.right)
    ) {
      return null;
    }

    const currentSource = normalized.left.object.name;
    const currentColumn = normalized.left.property;

    if (sourceName === undefined) sourceName = currentSource;
    if (column === undefined) column = currentColumn;

    if (sourceName !== currentSource || column !== currentColumn) {
      return null;
    }

    literals.push(normalized.right);
  }

  const uniqueLiterals = dedupeExpressions(literals).sort((a, b) =>
    exprToString(a).localeCompare(exprToString(b)),
  );

  if (sourceName === undefined || column === undefined) {
    return null;
  }

  return {
    sourceName,
    column,
    literals: uniqueLiterals,
  };
}

function collectAndChain(expr: LuaExpression): LuaExpression[] {
  if (expr.type === "Binary" && expr.operator === "and") {
    return [...collectAndChain(expr.left), ...collectAndChain(expr.right)];
  }
  return [expr];
}

function collectOrChain(expr: LuaExpression): LuaExpression[] {
  if (expr.type === "Binary" && expr.operator === "or") {
    return [...collectOrChain(expr.left), ...collectOrChain(expr.right)];
  }
  return [expr];
}

function dedupeExpressions(exprs: LuaExpression[]): LuaExpression[] {
  const out: LuaExpression[] = [];
  for (const expr of exprs) {
    if (!out.some((existing) => exprStructurallyEquals(existing, expr))) {
      out.push(expr);
    }
  }
  return out;
}

function rebuildAndExpression(
  exprs: LuaExpression[],
): LuaExpression | undefined {
  if (exprs.length === 0) return undefined;
  return exprs.slice(1).reduce(
    (acc, expr) =>
      ({
        type: "Binary",
        operator: "and",
        left: acc,
        right: expr,
        ctx: acc.ctx,
      }) as LuaExpression,
    exprs[0],
  );
}

function rebuildOrExpression(
  exprs: LuaExpression[],
): LuaExpression | undefined {
  if (exprs.length === 0) return undefined;
  return exprs.slice(1).reduce(
    (acc, expr) =>
      ({
        type: "Binary",
        operator: "or",
        left: acc,
        right: expr,
        ctx: acc.ctx,
      }) as LuaExpression,
    exprs[0],
  );
}

function isColumnRefExpr(expr: LuaExpression): boolean {
  return expr.type === "PropertyAccess" && expr.object.type === "Variable";
}

function isExplicitlyScopedToSource(
  expr: LuaExpression,
  sourceNames: Set<string>,
  targetSource: string,
): boolean {
  switch (expr.type) {
    case "Nil":
    case "Boolean":
    case "Number":
    case "String":
      return true;

    case "Variable":
      return expr.name === targetSource;

    case "PropertyAccess":
      if (
        expr.object.type === "Variable" &&
        sourceNames.has(expr.object.name)
      ) {
        return expr.object.name === targetSource;
      }
      return isExplicitlyScopedToSource(expr.object, sourceNames, targetSource);

    case "TableAccess":
      return (
        isExplicitlyScopedToSource(expr.object, sourceNames, targetSource) &&
        isExplicitlyScopedToSource(expr.key, sourceNames, targetSource)
      );

    case "Binary":
      return (
        isExplicitlyScopedToSource(expr.left, sourceNames, targetSource) &&
        isExplicitlyScopedToSource(expr.right, sourceNames, targetSource)
      );

    case "Unary":
      return isExplicitlyScopedToSource(
        expr.argument,
        sourceNames,
        targetSource,
      );

    case "Parenthesized":
      return isExplicitlyScopedToSource(
        expr.expression,
        sourceNames,
        targetSource,
      );

    case "FunctionCall":
      return (
        isExplicitlyScopedToSource(expr.prefix, sourceNames, targetSource) &&
        expr.args.every((arg) =>
          isExplicitlyScopedToSource(arg, sourceNames, targetSource),
        ) &&
        (!expr.orderBy ||
          expr.orderBy.every(
            // Wildcard entries satisfy the scope predicate trivially;
            // expansion happens at sort time.
            (ob) =>
              ob.expression === undefined ||
              isExplicitlyScopedToSource(
                ob.expression,
                sourceNames,
                targetSource,
              ),
          ))
      );

    case "FilteredCall":
      return (
        isExplicitlyScopedToSource(expr.call, sourceNames, targetSource) &&
        isExplicitlyScopedToSource(expr.filter, sourceNames, targetSource)
      );

    case "AggregateCall":
      return (
        isExplicitlyScopedToSource(expr.call, sourceNames, targetSource) &&
        expr.orderBy.every(
          (ob) =>
            ob.expression === undefined ||
            isExplicitlyScopedToSource(
              ob.expression,
              sourceNames,
              targetSource,
            ),
        )
      );

    case "TableConstructor":
      return expr.fields.every((field) => {
        switch (field.type) {
          case "DynamicField":
            return (
              isExplicitlyScopedToSource(
                field.key,
                sourceNames,
                targetSource,
              ) &&
              isExplicitlyScopedToSource(field.value, sourceNames, targetSource)
            );
          case "PropField":
          case "ExpressionField":
            return isExplicitlyScopedToSource(
              field.value,
              sourceNames,
              targetSource,
            );
          default:
            return false;
        }
      });

    case "QueryIn":
      return (
        isExplicitlyScopedToSource(expr.left, sourceNames, targetSource) &&
        isExplicitlyScopedToSource(expr.right, sourceNames, targetSource)
      );

    default:
      return false;
  }
}

function flattenAnd(expr: LuaExpression): LuaExpression[] {
  if (expr.type === "Binary" && expr.operator === "and") {
    return [...flattenAnd(expr.left), ...flattenAnd(expr.right)];
  }
  return [expr];
}

// Pruned WHERE + dropped AST nodes for EXPLAIN.
export type PruneTautologiesResult = {
  expr: LuaExpression | undefined;
  pruned: LuaExpression[];
};

// Remove top-level AND conjuncts that are always true. OR and `false`/`nil` unchanged.
export function pruneAlwaysTrueConjuncts(
  expr: LuaExpression | undefined,
): PruneTautologiesResult {
  if (!expr) return { expr, pruned: [] };
  const conjuncts = flattenAnd(expr);
  if (conjuncts.length === 1 && !isAlwaysTrueLiteral(conjuncts[0])) {
    return { expr, pruned: [] };
  }
  const kept: LuaExpression[] = [];
  const pruned: LuaExpression[] = [];
  for (const c of conjuncts) {
    if (isAlwaysTrueLiteral(c)) {
      pruned.push(c);
    } else {
      kept.push(c);
    }
  }
  if (pruned.length === 0) return { expr, pruned };
  return { expr: rebuildAndExpression(kept), pruned };
}

function isAlwaysTrueLiteral(expr: LuaExpression): boolean {
  if (expr.type === "Parenthesized") {
    return isAlwaysTrueLiteral(expr.expression);
  }
  if (expr.type === "Boolean") return expr.value === true;
  if (expr.type === "Unary" && expr.operator === "not") {
    return isAlwaysFalseLiteral(expr.argument);
  }
  return false;
}

function isAlwaysFalseLiteral(expr: LuaExpression): boolean {
  if (expr.type === "Parenthesized") {
    return isAlwaysFalseLiteral(expr.expression);
  }
  if (expr.type === "Boolean") return expr.value === false;
  if (expr.type === "Nil") return true;
  return false;
}

// Display strings for pruned conjuncts (EXPLAIN VERBOSE).
export function formatPrunedConjuncts(pruned: LuaExpression[]): string[] {
  return pruned.map((p) => exprToDisplayString(p));
}

function collectReferencedSources(
  expr: LuaExpression,
  sourceNames: Set<string>,
): Set<string> {
  const refs = new Set<string>();
  walkExprForSources(expr, sourceNames, refs);
  return refs;
}

function walkExprForSources(
  expr: LuaExpression,
  sourceNames: Set<string>,
  refs: Set<string>,
): void {
  switch (expr.type) {
    case "PropertyAccess":
      if (
        expr.object.type === "Variable" &&
        sourceNames.has(expr.object.name)
      ) {
        refs.add(expr.object.name);
      } else {
        walkExprForSources(expr.object, sourceNames, refs);
      }
      break;
    case "Variable":
      if (sourceNames.has(expr.name)) {
        refs.add(expr.name);
      }
      break;
    case "Binary":
      walkExprForSources(expr.left, sourceNames, refs);
      walkExprForSources(expr.right, sourceNames, refs);
      break;
    case "Unary":
      walkExprForSources(expr.argument, sourceNames, refs);
      break;
    case "FunctionCall":
      walkExprForSources(expr.prefix, sourceNames, refs);
      for (const arg of expr.args) {
        walkExprForSources(arg, sourceNames, refs);
      }
      break;
    case "Parenthesized":
      walkExprForSources(expr.expression, sourceNames, refs);
      break;
    case "TableAccess":
      walkExprForSources(expr.object, sourceNames, refs);
      walkExprForSources(expr.key, sourceNames, refs);
      break;
    case "QueryIn":
      walkExprForSources(expr.left, sourceNames, refs);
      walkExprForSources(expr.right, sourceNames, refs);
      break;
    default:
      break;
  }
}

export async function applyPushedFilters(
  items: any[],
  sourceName: string,
  filters: SingleSourceFilter[],
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<any[]> {
  if (filters.length === 0) return items;

  const relevant = filters.filter((f) => f.sourceName === sourceName);
  if (relevant.length === 0) return items;

  let result = items;
  for (const filter of relevant) {
    const filtered: any[] = [];
    for (const item of result) {
      const filterEnv = new LuaEnv(env);
      filterEnv.setLocal(sourceName, item);
      const val = await evalExpression(filter.expression, filterEnv, sf);
      if (luaTruthy(val)) {
        filtered.push(item);
      }
    }
    result = filtered;
  }
  return result;
}

export async function applyPushedFiltersWithStats(
  items: any[],
  sourceName: string,
  filters: SingleSourceFilter[],
  env: LuaEnv,
  sf: LuaStackFrame,
): Promise<{ result: any[]; removedCount: number }> {
  if (filters.length === 0) return { result: items, removedCount: 0 };

  const relevant = filters.filter((f) => f.sourceName === sourceName);
  if (relevant.length === 0) return { result: items, removedCount: 0 };

  let result = items;
  for (const filter of relevant) {
    const filtered: any[] = [];
    for (const item of result) {
      const filterEnv = new LuaEnv(env);
      filterEnv.setLocal(sourceName, item);
      const val = await evalExpression(filter.expression, filterEnv, sf);
      if (luaTruthy(val)) {
        filtered.push(item);
      }
    }
    result = filtered;
  }
  return { result, removedCount: items.length - result.length };
}

// Transitive predicate generation

export function generateTransitivePredicates(
  pushedFilters: SingleSourceFilter[],
  equiPreds: EquiPredicate[],
  sourceNames: Set<string>,
): SingleSourceFilter[] {
  if (pushedFilters.length === 0 || equiPreds.length === 0) return [];

  const generated: SingleSourceFilter[] = [];

  for (const filter of pushedFilters) {
    const candidates = extractTransitiveCandidates(
      filter.expression,
      filter.sourceName,
    );

    for (const candidate of candidates) {
      for (const ep of equiPreds) {
        let targetSource: string | null = null;
        let targetColumn: string | null = null;

        if (
          ep.leftSource === filter.sourceName &&
          ep.leftColumn === candidate.column
        ) {
          targetSource = ep.rightSource;
          targetColumn = ep.rightColumn;
        } else if (
          ep.rightSource === filter.sourceName &&
          ep.rightColumn === candidate.column
        ) {
          targetSource = ep.leftSource;
          targetColumn = ep.leftColumn;
        }

        if (!targetSource || !targetColumn) continue;
        if (!sourceNames.has(targetSource)) continue;

        const alreadyExists = pushedFilters.some(
          (f) =>
            f.sourceName === targetSource &&
            isStructurallyEquivalentFilter(
              f.expression,
              targetSource!,
              targetColumn!,
              candidate.op,
              candidate.literalExpr,
            ),
        );
        if (alreadyExists) continue;

        const alreadyGenerated = generated.some(
          (f) =>
            f.sourceName === targetSource &&
            isStructurallyEquivalentFilter(
              f.expression,
              targetSource!,
              targetColumn!,
              candidate.op,
              candidate.literalExpr,
            ),
        );
        if (alreadyGenerated) continue;

        const newExpr: LuaExpression = {
          type: "Binary",
          operator: candidate.op,
          left: {
            type: "PropertyAccess",
            object: { type: "Variable", name: targetSource, ctx: {} },
            property: targetColumn,
            ctx: {},
          } as LuaExpression,
          right: candidate.literalExpr,
          ctx: filter.expression.ctx,
        } as LuaExpression;

        generated.push({
          sourceName: targetSource,
          expression: newExpr,
        });
      }
    }
  }

  return generated;
}

type TransitiveCandidate = {
  column: string;
  op: string;
  literalExpr: LuaExpression;
};

function extractTransitiveCandidates(
  expr: LuaExpression,
  sourceName: string,
): TransitiveCandidate[] {
  const results: TransitiveCandidate[] = [];
  expr = normalizePushdownExpression(expr);

  if (expr.type === "Binary" && expr.operator === "and") {
    results.push(...extractTransitiveCandidates(expr.left, sourceName));
    results.push(...extractTransitiveCandidates(expr.right, sourceName));
    return results;
  }

  if (expr.type !== "Binary") return results;

  const op = expr.operator;
  if (
    op !== "==" &&
    op !== "~=" &&
    op !== "!=" &&
    op !== "<" &&
    op !== "<=" &&
    op !== ">" &&
    op !== ">="
  ) {
    return results;
  }

  const leftCol = extractSourceColumn(expr.left, sourceName);
  if (leftCol && isLiteralExpr(expr.right)) {
    results.push({ column: leftCol, op, literalExpr: expr.right });
    return results;
  }

  const rightCol = extractSourceColumn(expr.right, sourceName);
  if (rightCol && isLiteralExpr(expr.left)) {
    const flipped = flipOp(op);
    if (flipped) {
      results.push({ column: rightCol, op: flipped, literalExpr: expr.left });
    }
  }

  return results;
}

function extractSourceColumn(
  expr: LuaExpression,
  sourceName: string,
): string | null {
  if (
    expr.type === "PropertyAccess" &&
    expr.object.type === "Variable" &&
    expr.object.name === sourceName
  ) {
    return expr.property;
  }
  return null;
}

function isLiteralExpr(expr: LuaExpression): boolean {
  return (
    expr.type === "String" ||
    expr.type === "Number" ||
    expr.type === "Boolean" ||
    expr.type === "Nil"
  );
}

function flipOp(op: string): string | null {
  switch (op) {
    case "==":
      return "==";
    case "~=":
      return "~=";
    case "!=":
      return "!=";
    case "<":
      return ">";
    case "<=":
      return ">=";
    case ">":
      return "<";
    case ">=":
      return "<=";
    default:
      return null;
  }
}

function isStructurallyEquivalentFilter(
  expr: LuaExpression,
  sourceName: string,
  column: string,
  op: string,
  literalExpr: LuaExpression,
): boolean {
  if (expr.type !== "Binary" || expr.operator !== op) return false;

  const leftCol = extractSourceColumn(expr.left, sourceName);
  if (leftCol !== column) return false;

  return exprStructurallyEquals(expr.right, literalExpr);
}

export function stripUsedJoinPredicates(
  expr: LuaExpression | undefined,
  tree: JoinNode,
): LuaExpression | undefined {
  if (!expr) return undefined;
  const usedPreds = collectUsedEquiPredsFromJoinTree(tree);
  const usedResiduals = collectUsedJoinResidualsFromJoinTree(tree);
  return stripJoinPredicates(expr, usedPreds, usedResiduals);
}

function collectUsedEquiPredsFromJoinTree(node: JoinNode): EquiPredicate[] {
  if (node.kind === "leaf") return [];
  const result: EquiPredicate[] = [];
  if (node.equiPred) result.push(node.equiPred);
  result.push(...collectUsedEquiPredsFromJoinTree(node.left));
  result.push(...collectUsedEquiPredsFromJoinTree(node.right));
  return result;
}

function collectUsedJoinResidualsFromJoinTree(node: JoinNode): LuaExpression[] {
  if (node.kind === "leaf") return [];
  const result: LuaExpression[] = [];
  if (node.joinResiduals) {
    result.push(...node.joinResiduals);
  }
  result.push(...collectUsedJoinResidualsFromJoinTree(node.left));
  result.push(...collectUsedJoinResidualsFromJoinTree(node.right));
  return result;
}

function findLeafSource(
  node: JoinNode,
  sourceName: string,
): JoinSource | undefined {
  if (node.kind === "leaf") {
    return node.source.name === sourceName ? node.source : undefined;
  }
  return (
    findLeafSource(node.left, sourceName) ??
    findLeafSource(node.right, sourceName)
  );
}

function explainNdvSource(
  leftSS: StatsSource | undefined,
  rightSS: StatsSource | undefined,
  hasObservedLeftNdv: boolean,
  hasObservedRightNdv: boolean,
): ExplainNode["ndvSource"] {
  if (!(hasObservedLeftNdv || hasObservedRightNdv)) {
    return "row-count heuristic";
  }
  const isBitmapSource = (s: StatsSource | undefined) =>
    s === "persisted-complete" || s === "recomputed-filtered-exact";
  if (isBitmapSource(leftSS) || isBitmapSource(rightSS)) {
    return "roaring-bitmap index";
  }
  if (
    leftSS === "computed-sketch-large" ||
    rightSS === "computed-sketch-large"
  ) {
    return "half-xor heuristic";
  }
  return "row-count heuristic";
}

function explainExecutionScanKind(
  stats: CollectionStats | undefined,
): string | undefined {
  const primary = collectionPrimaryEngine(stats);
  if (!primary) return undefined;

  if (collectionHasPlannerCapability(stats, "scan-bitmap")) {
    return "bitmap";
  }
  if (collectionHasPlannerCapability(stats, "scan-index")) {
    return "index";
  }
  if (collectionHasPlannerCapability(stats, "scan-kv")) {
    return "kv";
  }
  if (collectionHasPlannerCapability(stats, "scan-materialized")) {
    return "materialized";
  }
  return primary.kind;
}

function explainPredicatePushdown(
  stats: CollectionStats | undefined,
  augmenterEngaged: boolean,
): string | undefined {
  let bitmapTier: "bitmap-extended" | "bitmap-basic" | "basic" | undefined;
  const hasStageWhere = collectionHasPlannerCapability(stats, "stage-where");
  if (hasStageWhere) {
    if (
      collectionHasPlannerCapability(stats, "scan-bitmap") &&
      (collectionHasPlannerCapability(stats, "pred-in") ||
        collectionHasPlannerCapability(stats, "bool-or") ||
        collectionHasPlannerCapability(stats, "bool-not"))
    ) {
      bitmapTier = "bitmap-extended";
    } else if (collectionHasPlannerCapability(stats, "scan-bitmap")) {
      bitmapTier = "bitmap-basic";
    } else {
      bitmapTier = "basic";
    }
  }

  const hasAugmenterEngine =
    augmenterEngaged && collectionHasPlannerCapability(stats, "scan-augmenter");

  if (!bitmapTier && !hasAugmenterEngine) {
    return (stats?.executionCapabilities?.engines?.length ?? 0) > 0
      ? "none"
      : undefined;
  }

  const parts: string[] = [];
  if (bitmapTier) parts.push(bitmapTier);
  if (hasAugmenterEngine) parts.push("augmenter-overlay");
  return parts.join(", ");
}

// Virtual columns referenced in the pushed predicate.
function engagedVirtualColumns(
  virtualColumns: VirtualColumnInfo[] | undefined,
  sourceName: string,
  predicateStrings: ReadonlyArray<string | undefined>,
): VirtualColumnInfo[] {
  if (!virtualColumns || virtualColumns.length === 0) return [];
  const haystack = predicateStrings.filter((s): s is string => !!s).join("\n");
  if (haystack.length === 0) return [];
  const out: VirtualColumnInfo[] = [];
  for (const vc of virtualColumns) {
    const col = vc.column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const src = sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b(?:${src}\\.)?${col}\\b`);
    if (re.test(haystack)) out.push(vc);
  }
  return out;
}

export function buildExplainScanNode(args: {
  sourceName: string;
  sourceExpression: LuaExpression;
  stats?: CollectionStats;
  withHints?: LuaWithHints;
  materialized?: boolean;
  hint?: LuaJoinHint;
  pushedFilterExpr?: string;
  normalizationInfo?: SourceNormalizationInfo;
}): ExplainNode {
  const rows =
    args.withHints?.rows ?? args.stats?.rowCount ?? DEFAULT_ESTIMATED_ROWS;
  const width =
    args.withHints?.width ??
    args.stats?.avgColumnCount ??
    DEFAULT_ESTIMATED_WIDTH;
  const estimatedCost = args.withHints?.cost ?? rows;
  const isFnScan = args.sourceExpression.type === "FunctionCall";

  let normalizationState: ExplainNode["normalizationState"] | undefined;
  let originalPredicateExpr: string | undefined;
  let normalizedPredicateExpr: string | undefined;
  let normalizedPushdownExpr: string | undefined;
  let normalizedLeftoverExpr: string | undefined;

  if (args.normalizationInfo) {
    normalizationState = args.normalizationInfo.state;
    originalPredicateExpr = args.normalizationInfo.originalExpr;
    normalizedPredicateExpr = args.normalizationInfo.normalizedExpr;
    normalizedPushdownExpr = args.normalizationInfo.pushdownExpr;
    normalizedLeftoverExpr = args.normalizationInfo.leftoverExpr;
  } else if (args.pushedFilterExpr) {
    normalizationState = "complete";
    originalPredicateExpr = args.pushedFilterExpr;
    normalizedPredicateExpr = args.pushedFilterExpr;
    normalizedPushdownExpr = args.pushedFilterExpr;
    normalizedLeftoverExpr = "none";
  }

  const sourceHints: string[] = [];
  if (args.materialized) {
    sourceHints.push("materialized");
  }
  if (args.withHints?.rows !== undefined) {
    sourceHints.push(`rows=${args.withHints.rows}`);
  }
  if (args.withHints?.width !== undefined) {
    sourceHints.push(`width=${args.withHints.width}`);
  }
  if (args.withHints?.cost !== undefined) {
    sourceHints.push(`cost=${args.withHints.cost}`);
  }

  const allEngines = args.stats?.executionCapabilities?.engines ?? [];

  const engagedVCols = engagedVirtualColumns(
    args.stats?.virtualColumns,
    args.sourceName,
    [
      args.pushedFilterExpr,
      args.normalizationInfo?.originalExpr,
      args.normalizationInfo?.normalizedExpr,
      args.normalizationInfo?.pushdownExpr,
      args.normalizationInfo?.leftoverExpr,
    ],
  );
  const augmenterEngaged = engagedVCols.length > 0;

  const engines = augmenterEngaged
    ? allEngines
    : allEngines.filter((e) => !e.id.startsWith("augmenter-overlay-"));

  const plannerCapabilities = new Set<string>();
  for (const engine of engines) {
    for (const capability of engine.capabilities) {
      plannerCapabilities.add(capability);
    }
  }

  const engineIds =
    engines.length > 0 ? engines.map((engine) => engine.id) : undefined;

  const plannerCapabilitiesList =
    plannerCapabilities.size > 0 ? [...plannerCapabilities].sort() : undefined;

  const engineCapabilityBreakdown:
    | NonNullable<ExplainNode["engineCapabilityBreakdown"]>
    | undefined =
    engines.length > 0
      ? engines.map((engine) => {
          const isAugmenter = engine.id.startsWith("augmenter-overlay-");
          const ownedColumns = isAugmenter
            ? engagedVCols.filter(
                (vc) => engine.id === `augmenter-overlay-${vc.overlay}`,
              )
            : undefined;
          return {
            id: engine.id,
            name: engine.name,
            kind: engine.kind,
            role: isAugmenter
              ? ("augmenter-overlay" as const)
              : ("primary" as const),
            capabilities: [...engine.capabilities].sort(),
            baseCostWeight: engine.baseCostWeight,
            priority: engine.priority,
            ownedColumns:
              ownedColumns && ownedColumns.length > 0
                ? ownedColumns
                : undefined,
            runtimeStats: engine.runtimeStats,
            executeMs: engine.executeMs,
          };
        })
      : undefined;

  return {
    nodeType: isFnScan ? "FunctionScan" : "Scan",
    source: args.sourceName,
    functionCall: isFnScan ? exprToString(args.sourceExpression) : undefined,
    hintUsed: args.hint ? formatHintLabel(args.hint) : undefined,
    sourceHints: sourceHints.length > 0 ? sourceHints : undefined,
    startupCost: 0,
    estimatedCost,
    estimatedRows: rows,
    estimatedWidth: width,
    filterExpr: args.pushedFilterExpr,
    pushedDownFilter: !!args.pushedFilterExpr,
    statsSource: args.stats?.statsSource,
    executionScanKind: explainExecutionScanKind(args.stats),
    predicatePushdown: explainPredicatePushdown(args.stats, augmenterEngaged),
    normalizationState,
    originalPredicateExpr,
    normalizedPredicateExpr,
    normalizedPushdownExpr,
    normalizedLeftoverExpr,
    engineIds,
    plannerCapabilities: plannerCapabilitiesList,
    engineCapabilityBreakdown,
    virtualColumns: engagedVCols.length > 0 ? engagedVCols : undefined,
    children: [],
  };
}

export function explainJoinTree(
  tree: JoinNode,
  _opts: ExplainOptions,
  pushedFilterExprBySource?: Map<string, string>,
  normalizationInfoBySource?: Map<string, SourceNormalizationInfo>,
): ExplainNode {
  if (tree.kind === "leaf") {
    return buildExplainScanNode({
      sourceName: tree.source.name,
      sourceExpression: tree.source.expression,
      stats: tree.source.stats,
      withHints: tree.source.withHints,
      materialized: tree.source.materialized,
      hint: tree.source.hint,
      pushedFilterExpr: pushedFilterExprBySource?.get(tree.source.name),
      normalizationInfo: normalizationInfoBySource?.get(tree.source.name),
    });
  }

  const leftPlan = explainJoinTree(
    tree.left,
    _opts,
    pushedFilterExprBySource,
    normalizationInfoBySource,
  );
  const rightPlan = explainJoinTree(
    tree.right,
    _opts,
    pushedFilterExprBySource,
    normalizationInfoBySource,
  );

  const jt = tree.joinType ?? "inner";

  const nodeType: ExplainNodeType =
    tree.method === "hash"
      ? "HashJoin"
      : tree.method === "merge"
        ? "MergeJoin"
        : "NestedLoop";

  const estRows =
    tree.estimatedRows ??
    estimateJoinCardinality(
      leftPlan.estimatedRows,
      rightPlan.estimatedRows,
      jt,
      1 / Math.max(leftPlan.estimatedRows, rightPlan.estimatedRows, 1),
    );

  const { startupCost, totalCost } = computeJoinCost(
    tree.method,
    jt,
    leftPlan.estimatedCost,
    leftPlan.estimatedRows,
    leftPlan.estimatedWidth,
    rightPlan.estimatedCost,
    rightPlan.estimatedRows,
    rightPlan.estimatedWidth,
  );

  const rightSource =
    tree.right.kind === "leaf" ? tree.right.source : undefined;
  const hintLabel = rightSource?.hint
    ? formatHintLabel(rightSource.hint)
    : undefined;

  const width = leftPlan.estimatedWidth + rightPlan.estimatedWidth;

  let ndvSource: ExplainNode["ndvSource"];
  let mcvUsed = false;
  let leftHasMcv = false;
  let rightHasMcv = false;
  let joinKeyNdv: ExplainNode["joinKeyNdv"] | undefined;
  let mcvKeyCount: number | undefined;
  let mcvFallback: ExplainNode["mcvFallback"] = "no-mcv";

  if (tree.equiPred) {
    const ep = tree.equiPred;

    const leftLeafSource = findLeafSource(tree.left, ep.leftSource);
    const rightStats = rightSource?.stats;

    const leftSS = leftLeafSource?.stats?.statsSource;
    const rightSS = rightStats?.statsSource;

    const hasObservedLeftNdv =
      tree.estimatedNdv?.get(ep.leftSource)?.has(ep.leftColumn) ?? false;
    const hasObservedRightNdv = rightStats?.ndv?.has(ep.rightColumn) ?? false;

    ndvSource = explainNdvSource(
      leftSS,
      rightSS,
      hasObservedLeftNdv,
      hasObservedRightNdv,
    );

    const leftMcv = tree.estimatedMcv?.get(ep.leftSource)?.get(ep.leftColumn);
    const rightMcv = rightStats?.mcv?.get(ep.rightColumn);

    const leftTrackedKeys = leftMcv?.trackedSize() ?? 0;
    const rightTrackedKeys = rightMcv?.trackedSize() ?? 0;

    leftHasMcv = leftTrackedKeys > 0;
    rightHasMcv = rightTrackedKeys > 0;

    const mcvAllowed = canUseMcvForPlanning(leftSS, rightSS);
    mcvUsed = mcvAllowed && leftHasMcv && rightHasMcv;

    if (mcvUsed) {
      mcvKeyCount = Math.min(leftTrackedKeys, rightTrackedKeys);
      mcvFallback = "no-mcv";
    } else if (leftHasMcv || rightHasMcv) {
      mcvKeyCount = Math.max(leftTrackedKeys, rightTrackedKeys);
      mcvFallback = mcvAllowed ? "one-sided" : "suppressed";
    } else {
      mcvFallback = "no-mcv";
    }

    const lNdv = tree.estimatedNdv?.get(ep.leftSource)?.get(ep.leftColumn);
    const rNdv =
      tree.estimatedNdv?.get(ep.rightSource)?.get(ep.rightColumn) ??
      rightStats?.ndv?.get(ep.rightColumn);

    joinKeyNdv = {
      left: `${ep.leftSource}.${ep.leftColumn}`,
      leftNdv: lNdv ?? -1,
      right: `${ep.rightSource}.${ep.rightColumn}`,
      rightNdv: rNdv ?? -1,
    };
  } else {
    ndvSource = "row-count heuristic";
  }

  return {
    nodeType,
    joinType: jt,
    method: tree.method,
    hintUsed: hintLabel,
    equiPred: tree.equiPred,
    joinResidualExprs: tree.joinResiduals?.map(exprToDisplayString),
    joinFilterType:
      tree.joinResiduals && tree.joinResiduals.length > 0
        ? "join-residual"
        : "join",
    startupCost: Math.round(startupCost),
    estimatedCost: Math.round(totalCost),
    estimatedRows: Math.max(1, Math.round(estRows)),
    estimatedWidth: width,
    selectivity: tree.estimatedSelectivity,
    selectivityTrace: tree.selectivityTrace,
    ndvSource,
    mcvUsed: mcvUsed || undefined,
    mcvFallback,
    mcvKeyCount,
    joinKeyNdv,
    statsSource: tree.statsSource,
    children: [leftPlan, rightPlan],
  };
}

function isAggregateFunctionName(name: string, config?: Config): boolean {
  return getAggregateSpec(name, config) !== null;
}

function selectContainsAggregate(
  expr: LuaExpression,
  runtimeConfig?: Config,
): boolean {
  switch (expr.type) {
    case "FilteredCall":
      return true;
    case "AggregateCall":
      return true;
    case "FunctionCall":
      if (
        expr.prefix.type === "Variable" &&
        isAggregateFunctionName(expr.prefix.name, runtimeConfig)
      ) {
        return true;
      }
      return expr.args.some((arg) =>
        selectContainsAggregate(arg, runtimeConfig),
      );
    case "TableConstructor":
      return expr.fields.some((f) => {
        switch (f.type) {
          case "PropField":
          case "ExpressionField":
            return selectContainsAggregate(f.value, runtimeConfig);
          case "DynamicField":
            return (
              selectContainsAggregate(f.key, runtimeConfig) ||
              selectContainsAggregate(f.value, runtimeConfig)
            );
        }
      });
    case "Binary":
      return (
        selectContainsAggregate(expr.left, runtimeConfig) ||
        selectContainsAggregate(expr.right, runtimeConfig)
      );
    case "Unary":
      return selectContainsAggregate(expr.argument, runtimeConfig);
    case "Parenthesized":
      return selectContainsAggregate(expr.expression, runtimeConfig);
    default:
      return false;
  }
}

// Whether the select list contains wildcards (`*`, `t.*`, or `*.col`).
function selectExprHasWildcards(expr: LuaExpression): boolean {
  if (expr.type !== "TableConstructor") return false;
  return expr.fields.some(
    (f) =>
      f.type === "StarField" ||
      f.type === "StarSourceField" ||
      f.type === "StarColumnField",
  );
}

function collectOutputColumns(
  expr: LuaExpression,
  runtimeConfig?: Config,
): string[] {
  if (expr.type !== "TableConstructor") {
    return [formatOutputExpression(expr, runtimeConfig)];
  }

  const outputs: string[] = [];

  for (const field of expr.fields) {
    switch (field.type) {
      case "PropField": {
        outputs.push(formatOutputExpression(field.value, runtimeConfig));
        break;
      }
      case "DynamicField": {
        outputs.push(formatOutputExpression(field.value, runtimeConfig));
        break;
      }
      case "ExpressionField": {
        outputs.push(formatOutputExpression(field.value, runtimeConfig));
        break;
      }
      case "StarField": {
        outputs.push("*");
        break;
      }
      case "StarSourceField": {
        outputs.push(`${field.source}.*`);
        break;
      }
      case "StarColumnField": {
        outputs.push(`*.${field.column}`);
        break;
      }
    }
  }

  return outputs;
}

function formatOutputExpression(
  expr: LuaExpression,
  runtimeConfig?: Config,
): string {
  const agg = formatAggregateExpression(expr, runtimeConfig);
  return agg ?? exprToDisplayString(expr);
}

// Quote non-identifier keys for `Result Columns:` (Postgres-style).
function formatResultKey(key: unknown): string {
  const s = typeof key === "string" ? key : String(key);
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Union string keys from result rows in first-seen order; skip numeric indices.
export function computeResultColumns(rows: unknown): string[] {
  if (!rows) return [];
  const arr: any[] = Array.isArray(rows)
    ? rows
    : rows && typeof rows === "object" && Symbol.iterator in (rows as any)
      ? Array.from(rows as Iterable<any>)
      : [];
  if (arr.length === 0) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of arr) {
    if (!row || typeof row !== "object") continue;
    const keys: Iterable<unknown> =
      typeof (row as any).keys === "function"
        ? ((row as any).keys() as Iterable<unknown>)
        : Object.keys(row as Record<string, unknown>);
    for (const k of keys) {
      if (typeof k !== "string") continue;
      if (/^\d+$/.test(k)) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(formatResultKey(k));
    }
  }
  return out;
}

function formatAggregateExpression(
  expr: LuaExpression,
  runtimeConfig?: Config,
): string | undefined {
  switch (expr.type) {
    case "FilteredCall": {
      const inner = formatAggregateExpression(expr.call, runtimeConfig);
      if (!inner) return undefined;
      return `${inner} filter(${exprToDisplayString(expr.filter)})`;
    }

    case "AggregateCall": {
      const inner = formatAggregateExpression(expr.call, runtimeConfig);
      if (!inner) return undefined;
      if (expr.orderBy.length === 0) {
        return inner;
      }
      const orderBy = expr.orderBy.map(formatIntraAggOrderByEntry).join(", ");
      return `${inner} order by ${orderBy}`;
    }

    case "FunctionCall": {
      if (
        expr.prefix.type === "Variable" &&
        isAggregateFunctionName(expr.prefix.name, runtimeConfig)
      ) {
        const args = expr.args.map(exprToDisplayString).join(", ");
        let s = `${expr.prefix.name}(${args})`;
        if (expr.orderBy && expr.orderBy.length > 0) {
          const orderBy = expr.orderBy
            .map(formatIntraAggOrderByEntry)
            .join(", ");
          s += ` order by ${orderBy}`;
        }
        return s;
      }
      return undefined;
    }

    default:
      return undefined;
  }
}

export function wrapPlanWithQueryOps(
  plan: ExplainNode,
  query: {
    orderBy?: OrderByEntry[];
    limit?: number;
    offset?: number;
    groupBy?: LuaGroupByEntry[];
    where?: LuaExpression;
    having?: LuaExpression;
    select?: LuaExpression;
    distinct?: boolean;
    leading?: string[];
  },
  sourceStats?: Map<string, CollectionStats>,
  accumulatedNdv?: Map<string, Map<string, number>>,
  config?: JoinPlannerConfig,
  runtimeConfig?: Config,
): ExplainNode {
  let root = plan;
  const filterSel = getDefaultFilterSelectivity(config);

  if (query.where) {
    root = {
      nodeType: "Filter",
      startupCost: root.startupCost,
      estimatedCost: root.estimatedCost,
      estimatedRows: Math.max(1, Math.round(root.estimatedRows * filterSel)),
      estimatedWidth: root.estimatedWidth,
      filterExpr: formatOutputExpression(query.where, runtimeConfig),
      whereExpr: query.where,
      filterType: "where",
      statsSource: root.statsSource,
      children: [root],
    };
  }

  const allAggDescsRaw: AggregateDescription[] = [];
  if (query.select) {
    allAggDescsRaw.push(
      ...collectAggregateDescriptions(query.select, runtimeConfig),
    );
  }
  if (query.having) {
    allAggDescsRaw.push(
      ...collectAggregateDescriptions(query.having, runtimeConfig),
    );
  }
  const allAggDescs = dedupeAggregateDescriptions(allAggDescsRaw);

  if (query.groupBy && query.groupBy.length > 0) {
    const keys = query.groupBy.map((g) => {
      if (isExprGroupByEntry(g)) {
        return formatOutputExpression(g.expr, runtimeConfig);
      }
      if (g.kind === "wildcardSource") return `${g.source}.*`;
      return "*";
    });
    const ndvGroupRows = estimateGroupRowsFromNdv(
      root.estimatedRows,
      query.groupBy,
      sourceStats,
      accumulatedNdv,
    );
    const estimatedGroupRows =
      ndvGroupRows ?? Math.max(1, Math.round(root.estimatedRows * filterSel));

    let groupInput = root;
    groupInput = wrapAggregateLocalOps(groupInput, allAggDescs);

    root = {
      nodeType: "GroupAggregate",
      startupCost: groupInput.estimatedCost,
      estimatedCost: groupInput.estimatedCost + groupInput.estimatedRows,
      estimatedRows: estimatedGroupRows,
      estimatedWidth: groupInput.estimatedWidth,
      sortKeys: keys,
      groupBySpec: query.groupBy,
      aggregates: allAggDescs.length > 0 ? allAggDescs : undefined,
      implicitGroup: query.groupBy.length === 0 ? true : undefined,
      statsSource: groupInput.statsSource,
      children: [groupInput],
    };
  }

  if (query.having) {
    root = {
      nodeType: "Filter",
      startupCost: root.startupCost,
      estimatedCost: root.estimatedCost,
      estimatedRows: Math.max(1, Math.round(root.estimatedRows * filterSel)),
      estimatedWidth: root.estimatedWidth,
      filterExpr: formatOutputExpression(query.having, runtimeConfig),
      havingExpr: query.having,
      filterType: "having",
      statsSource: root.statsSource,
      children: [root],
    };
  }

  const hasExplicitGroupBy = query.groupBy && query.groupBy.length > 0;
  const isImplicitAggregate =
    query.select &&
    !hasExplicitGroupBy &&
    selectContainsAggregate(query.select, runtimeConfig);

  if (isImplicitAggregate) {
    const cols = collectOutputColumns(query.select!, runtimeConfig);
    const aggDescs = dedupeAggregateDescriptions(
      collectAggregateDescriptions(query.select!, runtimeConfig),
    );

    let aggInput = root;
    aggInput = wrapAggregateLocalOps(aggInput, aggDescs);

    root = {
      nodeType: "GroupAggregate",
      startupCost: aggInput.estimatedCost,
      estimatedCost: aggInput.estimatedCost + aggInput.estimatedRows,
      estimatedRows: 1,
      estimatedWidth: cols.length > 0 ? cols.length : aggInput.estimatedWidth,
      sortKeys: [],
      outputColumns: cols,
      aggregates: aggDescs.length > 0 ? aggDescs : undefined,
      implicitGroup: true,
      statsSource: aggInput.statsSource,
      children: [aggInput],
    };
  }

  const buildProject = (): void => {
    if (query.select) {
      // Wildcard lists: use child width until columns are resolved.
      const cols = collectOutputColumns(query.select, runtimeConfig);
      const hasWildcards = selectExprHasWildcards(query.select);
      root = {
        nodeType: "Project",
        startupCost: root.startupCost,
        estimatedCost: root.estimatedCost + root.estimatedRows,
        estimatedRows: root.estimatedRows,
        estimatedWidth: hasWildcards
          ? root.estimatedWidth
          : cols.length > 0
            ? cols.length
            : root.estimatedWidth,
        selectExpr: query.select,
        statsSource: root.statsSource,
        children: [root],
      };
    } else {
      root = {
        nodeType: "Project",
        startupCost: root.startupCost,
        estimatedCost: root.estimatedCost,
        estimatedRows: root.estimatedRows,
        estimatedWidth: root.estimatedWidth,
        statsSource: root.statsSource,
        children: [root],
      };
    }
  };

  const buildSort = (): void => {
    if (!query.orderBy || query.orderBy.length === 0) return;
    const keys = query.orderBy.map((o) => {
      let s: string;
      if (o.expr) {
        s = formatOutputExpression(o.expr, runtimeConfig);
      } else if (o.wildcard) {
        // EXPLAIN shows wildcards as written; runtime expands per-row.
        s =
          o.wildcard.kind === "all"
            ? "*"
            : o.wildcard.kind === "source"
              ? `${o.wildcard.source}.*`
              : `*.${o.wildcard.column}`;
      } else {
        s = "?";
      }
      if (o.desc) s += " desc";
      if (o.nulls) s += ` nulls ${o.nulls}`;
      if (o.using) {
        s += ` using ${typeof o.using === "string" ? o.using : "<function>"}`;
      }
      return s;
    });
    const nLogN =
      root.estimatedRows *
      Math.ceil(Math.log2(Math.max(2, root.estimatedRows)));
    root = {
      nodeType: "Sort",
      startupCost: root.estimatedCost,
      estimatedCost: root.estimatedCost + nLogN,
      estimatedRows: root.estimatedRows,
      estimatedWidth: root.estimatedWidth,
      sortKeys: keys,
      sortType: "query",
      orderBySpec: query.orderBy.map((o) => ({
        expr: o.expr,
        wildcard: o.wildcard,
        desc: o.desc,
        nulls: o.nulls,
        using:
          typeof o.using === "string"
            ? o.using
            : o.using
              ? "<function>"
              : undefined,
      })),
      statsSource: root.statsSource,
      children: [root],
    };
  };

  const isGrouped = !!hasExplicitGroupBy || !!isImplicitAggregate;
  // Grouped: project then sort; else sort then project (order may use non-selected cols).
  if (isGrouped) {
    buildProject();
    buildSort();
  } else {
    buildSort();
    buildProject();
  }

  if (query.distinct) {
    root = {
      nodeType: "Unique",
      startupCost: root.startupCost,
      estimatedCost: root.estimatedCost,
      estimatedRows: Math.max(
        1,
        Math.round(
          root.estimatedRows * getDefaultDistinctSurvivalRatio(config),
        ),
      ),
      estimatedWidth: root.estimatedWidth,
      distinctSpec: true,
      statsSource: root.statsSource,
      children: [root],
    };
  }

  if (query.limit !== undefined || query.offset !== undefined) {
    const offset = query.offset ?? 0;
    const limit = query.limit ?? root.estimatedRows;
    const startupFraction =
      offset > 0
        ? root.startupCost +
          (root.estimatedCost - root.startupCost) *
            (offset / Math.max(1, root.estimatedRows))
        : root.startupCost;
    root = {
      nodeType: "Limit",
      startupCost: Math.round(startupFraction),
      estimatedCost: root.estimatedCost,
      estimatedRows: Math.min(limit, Math.max(0, root.estimatedRows - offset)),
      estimatedWidth: root.estimatedWidth,
      limitCount: query.limit,
      offsetCount: query.offset,
      statsSource: root.statsSource,
      children: [root],
    };
  }

  populateNodeOutputColumns(root, sourceStats, runtimeConfig);

  return root;
}

/**
 * Bottom-up walk that fills in `node.outputColumns` for every plan node
 * that doesn't already have it (Project / implicit GroupAggregate populate
 * theirs at construction). Postgres prints a per-node `Output:` with the
 * tuple shape that node emits; we mirror that here.
 *
 * Single-source plans drop the alias prefix (Postgres' `useprefix=false`);
 * multi-source plans qualify columns as `<source>.<col>`. Sources whose
 * schema we don't know fall back to `<source>.*` (multi-source) or `*`
 * (single-source) -- explicit "we don't know yet, runtime expands".
 */
function populateNodeOutputColumns(
  node: ExplainNode,
  sourceStats?: Map<string, CollectionStats>,
  runtimeConfig?: Config,
): void {
  for (const child of node.children) {
    populateNodeOutputColumns(child, sourceStats, runtimeConfig);
  }

  if (node.outputColumns && node.outputColumns.length > 0) return;

  const knownSourceCount = sourceStats?.size ?? 0;
  const qualifiedScans = knownSourceCount > 1;

  switch (node.nodeType) {
    case "Scan":
    case "FunctionScan": {
      const source = node.source ?? "_";
      const stats = sourceStats?.get(source);
      if (
        stats &&
        (stats.ndv.size > 0 || (stats.virtualColumns?.length ?? 0) > 0)
      ) {
        // Primary (bitmap-stored) columns come from `ndv` keys; virtual
        // (overlay) columns from `virtualColumns`. Merge both so the
        // scan node's `Output:` reflects EVERY column it produces -- a
        // pure overlay column like `lastAccessed` is just as much part
        // of the tuple as a regular indexed column. Pre-cleanup only
        // primary columns showed, which made `select *` queries appear
        // to omit the overlay column even though it survives end-to-end.
        const primary = [...stats.ndv.keys()];
        const overlay = (stats.virtualColumns ?? []).map((vc) => vc.column);
        const merged = new Set<string>([...primary, ...overlay]);
        const cols = [...merged].sort();
        node.outputColumns = qualifiedScans
          ? cols.map((c) => `${source}.${c}`)
          : cols;
      } else {
        // No usable schema: stay symbolic, like Postgres' `*` placeholder
        // would be for a fully-unknown table.
        node.outputColumns = qualifiedScans ? [`${source}.*`] : ["*"];
      }
      break;
    }
    case "Filter":
    case "Sort":
    case "Limit":
    case "Unique": {
      const childCols = node.children[0]?.outputColumns;
      if (childCols && childCols.length > 0) {
        node.outputColumns = childCols.slice();
      }
      break;
    }
    case "HashJoin":
    case "NestedLoop":
    case "MergeJoin": {
      const merged: string[] = [];
      const seen = new Set<string>();
      for (const child of node.children) {
        for (const col of child.outputColumns ?? []) {
          if (!seen.has(col)) {
            seen.add(col);
            merged.push(col);
          }
        }
      }
      if (merged.length > 0) node.outputColumns = merged;
      break;
    }
    case "GroupAggregate": {
      // Group keys (already deparsed in `sortKeys`) followed by aggregate
      // descriptions in source order. The implicit-aggregate constructor
      // already sets `outputColumns` directly to the projected select list,
      // and we won't overwrite it (early-return above).
      const cols: string[] = [];
      if (node.sortKeys) cols.push(...node.sortKeys);
      if (node.aggregates) {
        for (const a of node.aggregates) {
          let s = `${a.name}(${a.args})`;
          if (a.filter) s += ` filter(${a.filter})`;
          if (a.orderBy) s += ` order by ${a.orderBy}`;
          cols.push(s);
        }
      }
      if (cols.length > 0) node.outputColumns = cols;
      break;
    }
    case "Project": {
      // Project resolves wildcards in its select-list against the child's
      // resolved column list -- so `select *` ends up showing the same
      // full column list the Hash Join below already shows, and Sort /
      // Unique / Limit above just passthrough the resolved set. Without
      // this Project would carry a symbolic `*` while everything below
      // shows the real columns, which the user (rightly) flagged as
      // confusing in `EXPLAIN VERBOSE`.
      const childCols = node.children[0]?.outputColumns ?? [];
      if (node.selectExpr) {
        node.outputColumns = resolveSelectAgainstChild(
          node.selectExpr,
          childCols,
          runtimeConfig,
        );
      } else if (childCols.length > 0) {
        // Implicit project (no select): inherit the child's columns.
        node.outputColumns = childCols.slice();
      }
      break;
    }
  }
}

// Expand select wildcards using child's resolved `Output:` column list.
function resolveSelectAgainstChild(
  selectExpr: LuaExpression,
  childOutputs: readonly string[],
  runtimeConfig?: Config,
): string[] {
  if (selectExpr.type !== "TableConstructor") {
    return [formatOutputExpression(selectExpr, runtimeConfig)];
  }

  // Single-source child outputs are bare names; multi-source use `src.col`. Skip lone `*` sentinel.
  const isSingleSource =
    childOutputs.length > 0 &&
    childOutputs.every((c) => !c.includes(".") && !c.includes("*"));

  const out: string[] = [];
  for (const field of selectExpr.fields) {
    switch (field.type) {
      case "PropField":
      case "DynamicField":
      case "ExpressionField": {
        out.push(formatOutputExpression(field.value, runtimeConfig));
        break;
      }
      case "StarField": {
        if (childOutputs.length > 0) {
          out.push(...childOutputs);
        } else {
          out.push("*");
        }
        break;
      }
      case "StarSourceField": {
        const prefix = `${field.source}.`;
        const matched = childOutputs.filter((c) => c.startsWith(prefix));
        if (matched.length > 0) {
          out.push(...matched);
        } else if (isSingleSource) {
          out.push(...childOutputs);
        } else {
          out.push(`${field.source}.*`);
        }
        break;
      }
      case "StarColumnField": {
        const suffix = `.${field.column}`;
        const matched = childOutputs.filter(
          (c) => c.endsWith(suffix) || (isSingleSource && c === field.column),
        );
        if (matched.length > 0) {
          out.push(...matched);
        } else {
          out.push(`*.${field.column}`);
        }
        break;
      }
    }
  }
  return out;
}

/**
 * Collect scan source names from an explain plan in execution (left-deep)
 * order.  The join tree is left-deep, so an in-order walk of Scan leaves
 * yields the order the planner chose.
 */
export function collectScanSourceOrder(plan: ExplainNode): string[] {
  const names: string[] = [];
  const walk = (node: ExplainNode) => {
    if (
      (node.nodeType === "Scan" || node.nodeType === "FunctionScan") &&
      node.source
    ) {
      names.push(node.source);
      return;
    }
    for (const child of node.children) {
      walk(child);
    }
  };
  walk(plan);
  return names;
}

/**
 * Build a structured summary of how the `leading` hint interacted with the
 * planner.  Returns `undefined` when no leading hint was given.  `originalOrder`
 * is the source ordering as written in the 'from' clause, before any planning.
 * `finalOrder` is derived from the explain plan and reflects the planner's
 * actual decision.
 */
export function buildLeadingHintInfo(
  requestedLeading: string[] | undefined,
  originalOrder: string[],
  plan: ExplainNode,
): LeadingHintInfo | undefined {
  if (!requestedLeading || requestedLeading.length === 0) return undefined;
  const finalOrder = collectScanSourceOrder(plan);
  const fixedSet = new Set(requestedLeading);
  const fixed = requestedLeading.filter((n) => finalOrder.includes(n));
  const plannerChosen = finalOrder.filter((n) => !fixedSet.has(n));
  return {
    original: [...originalOrder],
    requested: [...requestedLeading],
    fixed,
    plannerChosen,
    finalOrder,
  };
}

type RestrictedSourceRef = {
  source: string;
  joinType: "semi" | "anti";
};

function collectRestrictedPostJoinSources(
  node: JoinNode,
): Map<string, "semi" | "anti"> {
  const restricted = new Map<string, "semi" | "anti">();

  const collectLeafNames = (n: JoinNode, out: string[]) => {
    if (n.kind === "leaf") {
      out.push(n.source.name);
      return;
    }
    collectLeafNames(n.left, out);
    collectLeafNames(n.right, out);
  };

  const walk = (n: JoinNode) => {
    if (n.kind === "leaf") return;

    if (n.joinType === "semi" || n.joinType === "anti") {
      const rightNames: string[] = [];
      collectLeafNames(n.right, rightNames);
      for (const name of rightNames) {
        restricted.set(name, n.joinType);
      }
    }

    walk(n.left);
    walk(n.right);
  };

  walk(node);
  return restricted;
}

function collectIllegalRestrictedRefs(
  expr: LuaExpression | undefined,
  restricted: Map<string, "semi" | "anti">,
  out: RestrictedSourceRef[],
): void {
  if (!expr) return;

  switch (expr.type) {
    case "Variable":
      if (restricted.has(expr.name)) {
        out.push({
          source: expr.name,
          joinType: restricted.get(expr.name)!,
        });
      }
      return;

    case "PropertyAccess":
      if (expr.object.type === "Variable" && restricted.has(expr.object.name)) {
        out.push({
          source: expr.object.name,
          joinType: restricted.get(expr.object.name)!,
        });
        return;
      }
      collectIllegalRestrictedRefs(expr.object, restricted, out);
      return;

    case "TableAccess":
      collectIllegalRestrictedRefs(expr.object, restricted, out);
      collectIllegalRestrictedRefs(expr.key, restricted, out);
      return;

    case "Binary":
      collectIllegalRestrictedRefs(expr.left, restricted, out);
      collectIllegalRestrictedRefs(expr.right, restricted, out);
      return;

    case "Unary":
      collectIllegalRestrictedRefs(expr.argument, restricted, out);
      return;

    case "Parenthesized":
      collectIllegalRestrictedRefs(expr.expression, restricted, out);
      return;

    case "FunctionCall":
      collectIllegalRestrictedRefs(expr.prefix, restricted, out);
      for (const arg of expr.args) {
        collectIllegalRestrictedRefs(arg, restricted, out);
      }
      if (expr.orderBy) {
        for (const ob of expr.orderBy) {
          if (ob.expression) {
            collectIllegalRestrictedRefs(ob.expression, restricted, out);
          }
        }
      }
      return;

    case "FilteredCall":
      collectIllegalRestrictedRefs(expr.call, restricted, out);
      collectIllegalRestrictedRefs(expr.filter, restricted, out);
      return;

    case "AggregateCall":
      collectIllegalRestrictedRefs(expr.call, restricted, out);
      for (const ob of expr.orderBy) {
        if (ob.expression) {
          collectIllegalRestrictedRefs(ob.expression, restricted, out);
        }
      }
      return;

    case "TableConstructor":
      for (const field of expr.fields) {
        switch (field.type) {
          case "DynamicField":
            collectIllegalRestrictedRefs(field.key, restricted, out);
            collectIllegalRestrictedRefs(field.value, restricted, out);
            break;
          case "PropField":
          case "ExpressionField":
            collectIllegalRestrictedRefs(field.value, restricted, out);
            break;
        }
      }
      return;

    default:
      return;
  }
}

function throwIllegalRestrictedRef(
  ref: RestrictedSourceRef,
  sf: LuaStackFrame,
  ctx: LuaExpression["ctx"],
): never {
  throw new LuaRuntimeError(
    `invalid reference to '${ref.joinType}' join output column "${ref.source}"`,
    sf.withCtx(ctx),
  );
}

export function validatePostJoinSourceReferences(
  tree: JoinNode,
  query: {
    where?: LuaExpression;
    // Wildcard group-by entries are validated at runtime; ignored here.
    groupBy?: LuaGroupByEntry[];
    having?: LuaExpression;
    select?: LuaExpression;
    orderBy?: OrderByEntry[];
  },
  sf: LuaStackFrame,
): void {
  const restricted = collectRestrictedPostJoinSources(tree);
  if (restricted.size === 0) return;

  const check = (expr: LuaExpression | undefined) => {
    if (!expr) return;
    const bad: RestrictedSourceRef[] = [];
    collectIllegalRestrictedRefs(expr, restricted, bad);
    if (bad.length > 0) {
      throwIllegalRestrictedRef(bad[0], sf, expr.ctx);
    }
  };

  check(query.where);

  if (query.groupBy) {
    for (const g of query.groupBy) {
      if (isExprGroupByEntry(g)) {
        check(g.expr);
      }
    }
  }

  check(query.having);
  check(query.select);

  if (query.orderBy) {
    for (const o of query.orderBy) {
      check(o.expr);
    }
  }
}

function formatHintLabel(hint: LuaJoinHint): string {
  const parts: string[] = [];
  if (hint.joinType) parts.push(hint.joinType);
  parts.push(hint.kind);
  if (hint.using) parts.push("using");
  return parts.join(" ");
}

export function exprToString(expr: LuaExpression): string {
  switch (expr.type) {
    case "Binary":
      return `(${exprToString(expr.left)} ${expr.operator} ${exprToString(expr.right)})`;
    case "Unary":
      return `${expr.operator} ${exprToString(expr.argument)}`;
    case "PropertyAccess":
      return `${exprToString(expr.object)}.${expr.property}`;
    case "Variable":
      return expr.name;
    case "String":
      return `'${expr.value}'`;
    case "Number":
      return String(expr.value);
    case "Boolean":
      return String(expr.value);
    case "Nil":
      return "nil";
    case "OrderBySelectKey":
      return `[${exprToString(expr.key)}]`;
    case "FunctionCall": {
      const prefix = exprToString(expr.prefix);
      const args = expr.args.map(exprToString).join(", ");
      let s = `${prefix}(${args})`;
      if (expr.orderBy && expr.orderBy.length > 0) {
        s += ` order by ${expr.orderBy
          .map(formatIntraAggOrderByEntry)
          .join(", ")}`;
      }
      return s;
    }
    case "FilteredCall":
      return `${exprToString(expr.call)} filter(${exprToString(expr.filter)})`;
    case "AggregateCall": {
      let s = exprToString(expr.call);
      if (expr.orderBy.length > 0) {
        s += ` order by ${expr.orderBy
          .map(formatIntraAggOrderByEntry)
          .join(", ")}`;
      }
      return s;
    }
    case "TableAccess":
      return `${exprToString(expr.object)}[${exprToString(expr.key)}]`;
    case "Parenthesized":
      return exprToString(expr.expression);
    case "FunctionDefinition":
      return "<anonymous>";
    case "TableConstructor": {
      const parts: string[] = [];
      for (const field of expr.fields) {
        switch (field.type) {
          case "PropField":
            parts.push(`${field.key} = ${exprToString(field.value)}`);
            break;
          case "DynamicField":
            parts.push(
              `[${exprToString(field.key)}] = ${exprToString(field.value)}`,
            );
            break;
          case "ExpressionField":
            parts.push(exprToString(field.value));
            break;
        }
      }
      return `{ ${parts.join(", ")} }`;
    }
    case "QueryIn":
      return `${exprToString(expr.left)} in ${exprToString(expr.right)}`;
    default:
      return "?";
  }
}

/**
 * Strip one matched outer parenthesis pair from `s` if it encloses the whole
 * string.  `exprToString` always wraps Binary expressions in parens so that
 * nested rendering stays unambiguous — but at the top level of an EXPLAIN
 * line those outer parens are redundant noise.  Use this helper every time
 * an expression string is about to be emitted into rendered output.
 *
 * `((a) and (b))` -> `(a) and (b)`
 * `(a)`           -> `a`
 * `(a) or (b)`    -> `(a) or (b)`  (no enclosing pair, untouched)
 * `unknown_fn(x)` -> `unknown_fn(x)` (leading `(` is part of a call)
 */
export function stripOuterParens(s: string): string {
  if (s.length < 2 || s[0] !== "(" || s[s.length - 1] !== ")") {
    return s;
  }
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      // If the first `(` closes before the end, it doesn't enclose the
      // whole string — leave as-is.
      if (depth === 0 && i < s.length - 1) return s;
    }
  }
  return depth === 0 ? s.slice(1, -1) : s;
}

/**
 * Like `exprToString` but with the outermost redundant parenthesis pair
 * removed.  Use everywhere the resulting string is rendered directly as
 * part of an EXPLAIN output line.
 */
export function exprToDisplayString(expr: LuaExpression): string {
  return stripOuterParens(exprToString(expr));
}

// Renders one intra-aggregate 'order by' entry (expression or wildcard).
function formatIntraAggOrderByEntry(o: LuaOrderBy): string {
  let s: string;
  if (o.expression) {
    s = exprToDisplayString(o.expression);
  } else if (o.wildcard) {
    s =
      o.wildcard.kind === "all"
        ? "*"
        : o.wildcard.kind === "source"
          ? `${o.wildcard.source}.*`
          : `*.${o.wildcard.column}`;
  } else {
    s = "?";
  }
  if (o.direction === "desc") s += " desc";
  if (o.nulls) s += ` nulls ${o.nulls}`;
  return s;
}

function exprMatchesEquiPred(
  expr: LuaExpression,
  preds: EquiPredicate[],
): boolean {
  if (expr.type !== "Binary" || expr.operator !== "==") return false;
  const left = parseSourceColumnFromExpr(expr.left);
  const right = parseSourceColumnFromExpr(expr.right);
  if (!left || !right) return false;
  return preds.some(
    (ep) =>
      (ep.leftSource === left.source &&
        ep.leftColumn === left.column &&
        ep.rightSource === right.source &&
        ep.rightColumn === right.column) ||
      (ep.leftSource === right.source &&
        ep.leftColumn === right.column &&
        ep.rightSource === left.source &&
        ep.rightColumn === left.column),
  );
}

function parseSourceColumnFromExpr(
  expr: LuaExpression,
): { source: string; column: string } | null {
  if (expr.type !== "PropertyAccess") return null;
  if (expr.object.type !== "Variable") return null;
  return { source: expr.object.name, column: expr.property };
}

function stripJoinPredicates(
  expr: LuaExpression,
  preds: EquiPredicate[],
  residuals: LuaExpression[],
): LuaExpression | undefined {
  if (expr.type === "Binary" && expr.operator === "and") {
    const left = stripJoinPredicates(expr.left, preds, residuals);
    const right = stripJoinPredicates(expr.right, preds, residuals);
    if (!left && !right) return undefined;
    if (!left) return right;
    if (!right) return left;
    return { ...expr, left, right };
  }
  if (exprMatchesEquiPred(expr, preds)) return undefined;
  if (residuals.some((r) => exprStructurallyEquals(expr, r))) return undefined;
  return expr;
}

function wildcardDescriptorsEqual(
  a: LuaOrderBy["wildcard"],
  b: LuaOrderBy["wildcard"],
): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "all":
      return true;
    case "source":
      return a.source === (b as { kind: "source"; source: string }).source;
    case "column":
      return a.column === (b as { kind: "column"; column: string }).column;
  }
}

function orderByEntriesStructurallyEqual(
  a: LuaOrderBy,
  b: LuaOrderBy,
): boolean {
  if (a.direction !== b.direction || a.nulls !== b.nulls) return false;
  if (a.expression === undefined || b.expression === undefined) {
    return wildcardDescriptorsEqual(a.wildcard, b.wildcard);
  }
  return exprStructurallyEquals(a.expression, b.expression);
}

function exprStructurallyEquals(a: LuaExpression, b: LuaExpression): boolean {
  if (a.type !== b.type) return false;

  switch (a.type) {
    case "Nil":
      return true;
    case "Boolean":
      return a.value === (b as typeof a).value;
    case "Number":
      return (
        a.value === (b as typeof a).value &&
        a.numericType === (b as typeof a).numericType
      );
    case "String":
      return a.value === (b as typeof a).value;
    case "Variable":
      return a.name === (b as typeof a).name;
    case "PropertyAccess":
      return (
        a.property === (b as typeof a).property &&
        exprStructurallyEquals(a.object, (b as typeof a).object)
      );
    case "TableAccess":
      return (
        exprStructurallyEquals(a.object, (b as typeof a).object) &&
        exprStructurallyEquals(a.key, (b as typeof a).key)
      );
    case "Unary":
      return (
        a.operator === (b as typeof a).operator &&
        exprStructurallyEquals(a.argument, (b as typeof a).argument)
      );
    case "Binary":
      return (
        a.operator === (b as typeof a).operator &&
        exprStructurallyEquals(a.left, (b as typeof a).left) &&
        exprStructurallyEquals(a.right, (b as typeof a).right)
      );
    case "Parenthesized":
      return exprStructurallyEquals(a.expression, (b as typeof a).expression);
    case "FunctionCall": {
      const bb = b as typeof a;
      return (
        exprStructurallyEquals(a.prefix, bb.prefix) &&
        a.name === bb.name &&
        a.args.length === bb.args.length &&
        a.args.every((arg, i) => exprStructurallyEquals(arg, bb.args[i])) &&
        (a.orderBy?.length ?? 0) === (bb.orderBy?.length ?? 0) &&
        (a.orderBy ?? []).every((ob, i) =>
          orderByEntriesStructurallyEqual(ob, bb.orderBy![i]),
        )
      );
    }
    case "FilteredCall":
      return (
        exprStructurallyEquals(a.call, (b as typeof a).call) &&
        exprStructurallyEquals(a.filter, (b as typeof a).filter)
      );
    case "AggregateCall": {
      const bb = b as typeof a;
      return (
        exprStructurallyEquals(a.call, bb.call) &&
        a.orderBy.length === bb.orderBy.length &&
        a.orderBy.every((ob, i) =>
          orderByEntriesStructurallyEqual(ob, bb.orderBy[i]),
        )
      );
    }
    case "TableConstructor": {
      const bb = b as typeof a;
      return (
        a.fields.length === bb.fields.length &&
        a.fields.every((field, i) => {
          const other = bb.fields[i];
          if (field.type !== other.type) return false;
          switch (field.type) {
            case "PropField":
              return (
                other.type === "PropField" &&
                field.key === other.key &&
                exprStructurallyEquals(field.value, other.value)
              );
            case "ExpressionField":
              return (
                other.type === "ExpressionField" &&
                exprStructurallyEquals(field.value, other.value)
              );
            case "DynamicField":
              return (
                other.type === "DynamicField" &&
                exprStructurallyEquals(field.key, other.key) &&
                exprStructurallyEquals(field.value, other.value)
              );
          }
        })
      );
    }
    case "FunctionDefinition":
      return a === b;
    case "QueryIn":
      return (
        exprStructurallyEquals(a.left, (b as typeof a).left) &&
        exprStructurallyEquals(a.right, (b as typeof a).right)
      );
    default:
      return false;
  }
}

function collectAggregateDescriptions(
  expr: LuaExpression | undefined,
  runtimeConfig?: Config,
): AggregateDescription[] {
  if (!expr) return [];
  const result: AggregateDescription[] = [];
  walkAggregates(expr, result, runtimeConfig);
  return result;
}

function walkAggregates(
  expr: LuaExpression,
  out: AggregateDescription[],
  runtimeConfig?: Config,
): void {
  switch (expr.type) {
    case "FilteredCall": {
      const innerBefore = out.length;
      walkAggregates(expr.call, out, runtimeConfig);

      if (out.length > innerBefore) {
        const last = out[out.length - 1];
        if (!last.filter) {
          last.filter = exprToDisplayString(expr.filter);
        }
        return;
      }

      const fc = expr.call;
      if (
        fc.prefix.type === "Variable" &&
        isAggregateFunctionName(fc.prefix.name, runtimeConfig)
      ) {
        const args = fc.args.map(exprToDisplayString).join(", ");
        const desc: AggregateDescription = {
          name: fc.prefix.name,
          args,
          filter: exprToDisplayString(expr.filter),
        };
        if (fc.orderBy && fc.orderBy.length > 0) {
          desc.orderBy = fc.orderBy.map(formatIntraAggOrderByEntry).join(", ");
        }
        out.push(desc);
        return;
      }

      walkAggregates(expr.filter, out, runtimeConfig);
      return;
    }

    case "AggregateCall": {
      const innerBefore = out.length;
      walkAggregates(expr.call, out, runtimeConfig);

      if (out.length > innerBefore) {
        const last = out[out.length - 1];
        if (!last.orderBy && expr.orderBy.length > 0) {
          last.orderBy = expr.orderBy
            .map(formatIntraAggOrderByEntry)
            .join(", ");
        }
        return;
      }

      const fc = expr.call;
      if (
        fc.prefix.type === "Variable" &&
        isAggregateFunctionName(fc.prefix.name, runtimeConfig)
      ) {
        const args = fc.args.map(exprToDisplayString).join(", ");
        out.push({
          name: fc.prefix.name,
          args,
          orderBy: expr.orderBy.map(formatIntraAggOrderByEntry).join(", "),
        });
        return;
      }

      return;
    }

    case "FunctionCall": {
      if (
        expr.prefix.type === "Variable" &&
        isAggregateFunctionName(expr.prefix.name, runtimeConfig)
      ) {
        const args = expr.args.map(exprToDisplayString).join(", ");
        const desc: AggregateDescription = { name: expr.prefix.name, args };
        if (expr.orderBy && expr.orderBy.length > 0) {
          desc.orderBy = expr.orderBy
            .map(formatIntraAggOrderByEntry)
            .join(", ");
        }
        out.push(desc);
        return;
      }
      walkAggregates(expr.prefix, out, runtimeConfig);
      for (const arg of expr.args) {
        walkAggregates(arg, out, runtimeConfig);
      }
      return;
    }

    case "Binary":
      walkAggregates(expr.left, out, runtimeConfig);
      walkAggregates(expr.right, out, runtimeConfig);
      return;
    case "Unary":
      walkAggregates(expr.argument, out, runtimeConfig);
      return;
    case "Parenthesized":
      walkAggregates(expr.expression, out, runtimeConfig);
      return;
    case "TableConstructor":
      for (const field of expr.fields) {
        switch (field.type) {
          case "DynamicField":
            walkAggregates(field.key, out, runtimeConfig);
            walkAggregates(field.value, out, runtimeConfig);
            break;
          case "PropField":
          case "ExpressionField":
            walkAggregates(field.value, out, runtimeConfig);
            break;
        }
      }
      return;
    default:
      return;
  }
}

function dedupeAggregateDescriptions(
  aggDescs: AggregateDescription[],
): AggregateDescription[] {
  const seen = new Set<string>();
  const uniqueAggs: AggregateDescription[] = [];
  for (const agg of aggDescs) {
    let sig = `${agg.name}(${agg.args})`;
    if (agg.filter) sig += ` filter(${agg.filter})`;
    if (agg.orderBy) sig += ` order by ${agg.orderBy}`;
    if (!seen.has(sig)) {
      seen.add(sig);
      uniqueAggs.push(agg);
    }
  }
  return uniqueAggs;
}

function wrapAggregateLocalOps(
  root: ExplainNode,
  aggregates: AggregateDescription[] | undefined,
): ExplainNode {
  if (!aggregates || aggregates.length === 0) {
    return root;
  }

  let wrapped = root;

  const aggregatesWithOrder = aggregates.filter((agg) => !!agg.orderBy);
  if (aggregatesWithOrder.length > 0) {
    const sortKeys = aggregatesWithOrder.flatMap((agg) =>
      agg.orderBy ? [agg.orderBy] : [],
    );
    wrapped = {
      nodeType: "Sort",
      startupCost: wrapped.startupCost,
      estimatedCost: wrapped.estimatedCost + wrapped.estimatedRows,
      estimatedRows: wrapped.estimatedRows,
      estimatedWidth: wrapped.estimatedWidth,
      sortKeys,
      sortType: "group",
      statsSource: wrapped.statsSource,
      children: [wrapped],
    };
  }

  const aggregatesWithFilter = aggregates.filter((agg) => !!agg.filter);
  if (aggregatesWithFilter.length > 0) {
    wrapped = {
      nodeType: "Filter",
      startupCost: wrapped.startupCost,
      estimatedCost: wrapped.estimatedCost,
      estimatedRows: wrapped.estimatedRows,
      estimatedWidth: wrapped.estimatedWidth,
      filterExpr: aggregatesWithFilter
        .map((agg) => `${agg.name}(${agg.args}) filter(${agg.filter})`)
        .join(", "),
      filterType: "aggregate",
      statsSource: wrapped.statsSource,
      children: [wrapped],
    };
  }

  return wrapped;
}

function estimateGroupRowsFromNdv(
  inputRows: number,
  groupBy: LuaGroupByEntry[],
  sourceStats?: Map<string, CollectionStats>,
  accumulatedNdv?: Map<string, Map<string, number>>,
): number | undefined {
  if ((!sourceStats && !accumulatedNdv) || groupBy.length === 0) {
    return undefined;
  }

  let combinedNdv = 1;
  let foundAny = false;

  for (const g of groupBy) {
    // Wildcard entries expand to a data-dependent column count; no static
    // estimate possible. Fall back to the cardinality heuristic.
    if (!isExprGroupByEntry(g)) {
      return undefined;
    }
    const ref = parseGroupKeySourceColumn(g.expr);
    if (!ref) {
      return undefined;
    }

    if (!ref.source) {
      return undefined;
    }

    const accNdv = accumulatedNdv?.get(ref.source)?.get(ref.column);
    const leafNdv = sourceStats?.get(ref.source)?.ndv?.get(ref.column);
    const ndv = accNdv ?? leafNdv;
    if (ndv === undefined) {
      return undefined;
    }

    foundAny = true;
    combinedNdv *= Math.max(1, ndv);
  }

  if (!foundAny) return undefined;

  return Math.max(1, Math.min(inputRows, Math.round(combinedNdv)));
}

function findFirstAggregateFilterNode(
  node: ExplainNode,
): ExplainNode | undefined {
  if (node.nodeType === "Filter" && node.filterType === "aggregate") {
    return node;
  }
  for (const child of node.children) {
    const found = findFirstAggregateFilterNode(child);
    if (found) return found;
  }
  return undefined;
}

export async function executeAndInstrument(
  tree: JoinNode,
  plan: ExplainNode,
  env: LuaEnv,
  sf: LuaStackFrame,
  opts: ExplainOptions,
  config?: JoinPlannerConfig,
  overrides?: MaterializedSourceOverrides,
  // Query start ms (`eval.ts`); `actual time` START/TOTAL are relative.
  originMs?: number,
  pushedFilters?: SingleSourceFilter[],
): Promise<LuaTable[]> {
  const ownStartT = opts.analyze && opts.timing ? performance.now() : 0;
  const origin = originMs ?? 0;

  if (tree.kind === "leaf") {
    let items = await materializeSource(tree.source, env, sf, overrides);
    const unfilteredRowCount =
      tree.source.stats?.unfilteredRowCount ?? tree.source.stats?.rowCount;

    let jsRemovedCount = 0;
    if (pushedFilters && pushedFilters.length > 0) {
      const { result, removedCount } = await applyPushedFiltersWithStats(
        items,
        tree.source.name,
        pushedFilters,
        env,
        sf,
      );
      items = result;
      jsRemovedCount = removedCount;
    }

    const rows = items.map((item) => rowToTable(tree.source.name, item));
    plan.actualRows = rows.length;
    plan.actualLoops = 1;

    const sourceLevelRemoved =
      unfilteredRowCount !== undefined && unfilteredRowCount > items.length
        ? unfilteredRowCount - items.length
        : 0;
    const narrowed = tree.source.stats?.pushdownNarrowedRowCount;
    if (
      sourceLevelRemoved > 0 &&
      narrowed !== undefined &&
      unfilteredRowCount !== undefined &&
      narrowed >= items.length &&
      narrowed <= unfilteredRowCount
    ) {
      const pushdownRemoved = unfilteredRowCount - narrowed;
      const residualRemoved = narrowed - items.length;
      if (pushdownRemoved > 0) plan.rowsRemovedByPushdownCond = pushdownRemoved;
      const totalResidual = residualRemoved + jsRemovedCount;
      if (totalResidual > 0) plan.rowsRemovedByFilter = totalResidual;
    } else {
      const totalRemoved = sourceLevelRemoved + jsRemovedCount;
      if (totalRemoved > 0) {
        plan.rowsRemovedByFilter = totalRemoved;
      }
    }

    if (opts.analyze && opts.timing) {
      // Include eval.ts pre-pass wall time so scan TOTAL covers engine work (delegated path).
      const prepassWallMs = scanPrepassDurationMs(tree.source);
      const measuredEnd = performance.now();
      const startup = Math.round((ownStartT - origin) * 1000) / 1000;
      const total =
        Math.round(
          Math.max(measuredEnd - origin, ownStartT - origin + prepassWallMs) *
            1000,
        ) / 1000;
      plan.actualStartupTimeMs = startup;
      plan.actualTimeMs = total;
    }
    return rows;
  }

  const leftRows = await executeAndInstrument(
    tree.left,
    plan.children[0],
    env,
    sf,
    opts,
    config,
    overrides,
    originMs,
    pushedFilters,
  );
  if (tree.right.kind !== "leaf") {
    throw new Error(
      "join planner: right child must be a leaf (left-deep trees only)",
    );
  }
  const rightSource = tree.right.source;
  const rightUnfilteredRowCount =
    rightSource.stats?.unfilteredRowCount ?? rightSource.stats?.rowCount;
  const rightT0 = opts.analyze && opts.timing ? performance.now() : 0;
  let rightItems = await materializeSource(rightSource, env, sf, overrides);

  let rightJsRemoved = 0;
  if (pushedFilters && pushedFilters.length > 0) {
    const { result, removedCount } = await applyPushedFiltersWithStats(
      rightItems,
      rightSource.name,
      pushedFilters,
      env,
      sf,
    );
    rightItems = result;
    rightJsRemoved = removedCount;
  }

  plan.children[1].actualRows = rightItems.length;
  plan.children[1].actualLoops = 1;

  const rightSourceLevelRemoved =
    rightUnfilteredRowCount !== undefined &&
    rightUnfilteredRowCount > rightItems.length
      ? rightUnfilteredRowCount - rightItems.length
      : 0;
  const rightNarrowed = rightSource.stats?.pushdownNarrowedRowCount;
  const rightChildPlan = plan.children[1];
  if (
    rightSourceLevelRemoved > 0 &&
    rightNarrowed !== undefined &&
    rightUnfilteredRowCount !== undefined &&
    rightNarrowed >= rightItems.length &&
    rightNarrowed <= rightUnfilteredRowCount
  ) {
    const pushdownRemoved = rightUnfilteredRowCount - rightNarrowed;
    const residualRemoved = rightNarrowed - rightItems.length;
    if (pushdownRemoved > 0) {
      rightChildPlan.rowsRemovedByPushdownCond = pushdownRemoved;
    }
    const totalResidual = residualRemoved + rightJsRemoved;
    if (totalResidual > 0) rightChildPlan.rowsRemovedByFilter = totalResidual;
  } else {
    const rightTotalRemoved = rightSourceLevelRemoved + rightJsRemoved;
    if (rightTotalRemoved > 0) {
      rightChildPlan.rowsRemovedByFilter = rightTotalRemoved;
    }
  }

  if (opts.analyze && opts.timing) {
    const prepassWallMs = scanPrepassDurationMs(rightSource);
    const measuredEnd = performance.now();
    const startup = Math.round((rightT0 - origin) * 1000) / 1000;
    const total =
      Math.round(
        Math.max(measuredEnd - origin, rightT0 - origin + prepassWallMs) * 1000,
      ) / 1000;
    plan.children[1].actualStartupTimeMs = startup;
    plan.children[1].actualTimeMs = total;
  }

  const joinT0 = opts.analyze && opts.timing ? performance.now() : 0;

  const joinResult = await dispatchJoin(
    tree,
    leftRows,
    rightItems,
    rightSource,
    env,
    sf,
    config,
  );

  plan.actualRows = joinResult.length;
  plan.actualLoops = 1;

  if (tree.method === "hash") {
    const buildSideKind = pickHashBuildSide(leftRows.length, rightItems.length);
    plan.memoryRows =
      buildSideKind === "left" ? leftRows.length : rightItems.length;
    plan.hashBuildSide = buildSideKind;

    if (tree.equiPred) {
      const ep = normalizeEquiPredicateForJoin(
        tree.equiPred,
        tree.left,
        rightSource,
      );
      const seen = new Set<string>();
      if (buildSideKind === "left") {
        for (const lRow of leftRows) {
          const leftObj = lRow.rawGet(ep.leftSource);
          const val = extractField(leftObj, ep.leftColumn);
          const key = hashJoinKey(val);
          if (key !== null) seen.add(key);
        }
      } else {
        for (const rItem of rightItems) {
          const val = extractField(rItem, ep.rightColumn);
          const key = hashJoinKey(val);
          if (key !== null) seen.add(key);
        }
      }
      plan.hashBuckets = seen.size;
    }
  }

  if (tree.method === "loop") {
    plan.children[1].actualLoops = leftRows.length;
  }

  if (tree.method === "loop") {
    const crossProduct = leftRows.length * rightItems.length;
    const removed = crossProduct - joinResult.length;
    if (removed > 0) {
      plan.rowsRemovedByJoinFilter = removed;
    }
  }

  if (opts.analyze && opts.timing) {
    const startup = Math.round((joinT0 - origin) * 1000) / 1000;
    const total = Math.round((performance.now() - origin) * 1000) / 1000;
    plan.actualStartupTimeMs = startup;
    plan.actualTimeMs = total;
  }

  return joinResult;
}

export function attachAnalyzeQueryOpStats(
  plan: ExplainNode,
  aggregateStats: AggregateRuntimeStats,
): void {
  const aggregateFilterNode = findFirstAggregateFilterNode(plan);
  if (!aggregateFilterNode) return;
  aggregateFilterNode.rowsRemovedByAggregateFilter =
    aggregateStats.rowsRemovedByAggregateFilter;
}

export function formatExplainOutput(
  result: ExplainResult,
  opts: ExplainOptions,
): string {
  const lines: string[] = [];

  if (opts.hints && result.leadingHint) {
    formatLeadingHint(result.leadingHint, lines);
  }

  formatNode(result.plan, opts, 0, lines);
  if (
    opts.verbose &&
    opts.analyze &&
    result.resultColumns &&
    result.resultColumns.length > 0
  ) {
    lines.push(`Result Columns: ${result.resultColumns.join(", ")}`);
  }
  if (
    opts.verbose &&
    result.prunedPredicates &&
    result.prunedPredicates.length > 0
  ) {
    lines.push(
      `Pruned Predicates: ${result.prunedPredicates.join(", ")} (always-true)`,
    );
  }
  if (opts.summary) {
    lines.push(`Planning Time: ${result.planningTimeMs.toFixed(3)} ms`);
    if (opts.analyze && result.executionTimeMs !== undefined) {
      lines.push(`Execution Time: ${result.executionTimeMs.toFixed(3)} ms`);
    }
  }

  const indented = lines.map((l) => ` ${l}`);

  const maxWidth = Math.min(
    120,
    Math.max("QUERY PLAN".length, ...indented.map((l) => l.length)),
  );
  const header = "QUERY PLAN".padStart(
    Math.ceil(("QUERY PLAN".length + maxWidth) / 2),
  );
  const separator = "-".repeat(maxWidth);

  const rowCount = indented.length;

  return `\`\`\`\n${header}\n${separator}\n${indented.join("\n")}\n(${rowCount} ${rowCount === 1 ? "row" : "rows"})\n\`\`\``;
}

function formatLeadingHint(info: LeadingHintInfo, lines: string[]): void {
  const fmt = (items: string[]) => items.join(",");
  const parts = [`original=${fmt(info.original)}`, `hinted=${fmt(info.fixed)}`];
  if (info.plannerChosen.length > 0) {
    parts.push(`completed=${fmt(info.plannerChosen)}`);
  }
  lines.push(`Source Order: ${fmt(info.finalOrder)}  (${parts.join(" ")})`);
}

// Spaces before `->  ` on a plan line at this tree depth (depth 0 = root).
function explainPlanLinePad(depth: number): string {
  if (depth <= 0) return "";
  return " ".repeat(6 * depth - 3);
}

// Indent for detail lines (Filter, Output, …); aligned with child `->`.
function explainDetailLinePad(depth: number): string {
  return explainPlanLinePad(depth + 1);
}

function formatNode(
  node: ExplainNode,
  opts: ExplainOptions,
  depth: number,
  lines: string[],
  parentOutput?: ReadonlyArray<string>,
): void {
  const headerPad = explainPlanLinePad(depth);
  const prefix = depth === 0 ? "" : "->  ";
  const detailPad = explainDetailLinePad(depth);

  lines.push(formatNodeHeaderLine(node, opts, headerPad, prefix));

  formatJoinConditionSection(node, opts, detailPad, lines);
  formatFilterSection(node, opts, detailPad, lines);
  formatOutputShapingSection(node, opts, detailPad, lines, parentOutput);
  formatOperatorStatsSection(node, opts, detailPad, lines);

  if (opts.verbose) {
    formatSourceAndHintSection(node, opts, detailPad, lines);
    formatPushdownDetailSection(node, detailPad, lines);
    formatExecutionEngineSection(node, opts, detailPad, lines);
    formatPlannerEstimationSection(node, detailPad, lines);
  }

  for (const child of node.children) {
    formatNode(child, opts, depth + 1, lines, node.outputColumns);
  }
}

function formatNodeHeaderLine(
  node: ExplainNode,
  opts: ExplainOptions,
  headerPad: string,
  prefix: string,
): string {
  const label = formatNodeLabel(node);

  let estBlock = "";
  if (opts.costs) {
    const s = (node.startupCost ?? 0).toFixed(2);
    const t = (node.estimatedCost ?? 0).toFixed(2);
    estBlock = `  (cost=${s}..${t} rows=${node.estimatedRows} width=${node.estimatedWidth})`;
  }

  let actBlock = "";
  if (opts.analyze) {
    if (node.actualLoops === 0) {
      actBlock = " (never executed)";
    } else if (node.actualRows !== undefined) {
      let timeStr = "";
      if (opts.timing && node.actualTimeMs !== undefined) {
        const st = (node.actualStartupTimeMs ?? 0).toFixed(3);
        const tt = node.actualTimeMs.toFixed(3);
        timeStr = ` time=${st}..${tt}`;
      }
      const rowsStr = Number(node.actualRows).toFixed(2);
      const loopsStr = String(Math.round(node.actualLoops ?? 1));
      actBlock = ` (actual${timeStr} rows=${rowsStr} loops=${loopsStr})`;
    }
  }

  let limitSuffix = "";
  if (node.nodeType === "Limit") {
    const limStr =
      node.limitCount === undefined ? "ALL" : String(node.limitCount);
    const off = node.offsetCount ?? 0;
    limitSuffix = ` (limit=${limStr} offset=${off})`;
  }

  return `${headerPad}${prefix}${label}${estBlock}${actBlock}${limitSuffix}`;
}

// Join condition + its residuals, immediately followed by the runtime stat
// `Rows Removed by Join Filter` so cause and effect stay adjacent.
function formatJoinConditionSection(
  node: ExplainNode,
  opts: ExplainOptions,
  detailPad: string,
  lines: string[],
): void {
  if (node.equiPred) {
    const condLabel =
      node.method === "hash"
        ? "Hash Cond"
        : node.method === "merge"
          ? "Merge Cond"
          : "Join Filter";
    const ep = node.equiPred;
    // No outer parens: at the top level of a rendered line they are
    // redundant noise, matching the convention used for every other
    // expression surface in the explain output.
    lines.push(
      `${detailPad}${condLabel}: ${ep.leftSource}.${ep.leftColumn} == ${ep.rightSource}.${ep.rightColumn}`,
    );
  }

  if (node.joinResidualExprs && node.joinResidualExprs.length > 0) {
    const residualLabel =
      node.joinFilterType === "join-residual"
        ? "Residual Join Filter"
        : "Join Filter";
    for (const expr of node.joinResidualExprs) {
      lines.push(`${detailPad}${residualLabel}: ${stripOuterParens(expr)}`);
    }
  }

  if (
    opts.analyze &&
    node.rowsRemovedByJoinFilter !== undefined &&
    node.rowsRemovedByJoinFilter > 0
  ) {
    lines.push(
      `${detailPad}Rows Removed by Join Filter: ${node.rowsRemovedByJoinFilter}`,
    );
  }
}

// Filter expression followed by all related "Rows Removed by *" stats so the
// effect of the filter is visible right next to its definition.
function formatFilterSection(
  node: ExplainNode,
  opts: ExplainOptions,
  detailPad: string,
  lines: string[],
): void {
  if (node.filterExpr) {
    // For scan nodes the historic label `Pushdown Filter:` conflated
    // engine-pushed predicates with the row-by-row residual safety
    // net. Postgres uses `Index Cond:` (real pushdown) and `Filter:`
    // (residual) -- we mirror that intent with `Pushdown Cond:` for
    // the condition the planner pushed to the source. The exact
    // engine-vs-residual split per leaf is visible in the per-engine
    // block below; the row-count split is rendered as separate
    // `Rows Removed by Pushdown Cond` and `Rows Removed by Filter`
    // lines (see below).
    let filterLabel: string;
    if (node.nodeType === "Scan" || node.nodeType === "FunctionScan") {
      filterLabel = node.pushedDownFilter ? "Pushdown Cond" : "Filter";
    } else if (node.filterType === "having") {
      filterLabel = "Filter";
    } else if (node.filterType === "aggregate") {
      filterLabel = "Filter";
    } else {
      filterLabel = "Filter";
    }
    lines.push(
      `${detailPad}${filterLabel}: ${stripOuterParens(node.filterExpr)}`,
    );
  }

  if (opts.analyze) {
    const isScan = node.nodeType === "Scan" || node.nodeType === "FunctionScan";

    // Split rows-removed counters when the source reported a narrowing
    // breakdown. `Rows Removed by Pushdown Cond` is the engine-narrowed
    // share; `Rows Removed by Filter` is the row-by-row residual. When
    // no breakdown is available (legacy non-dispatcher source), the
    // combined count surfaces as `Rows Removed by Pushdown Filter` for
    // backwards compatibility.
    if (
      isScan &&
      node.pushedDownFilter &&
      node.rowsRemovedByPushdownCond !== undefined &&
      node.rowsRemovedByPushdownCond > 0
    ) {
      lines.push(
        `${detailPad}Rows Removed by Pushdown Cond: ${node.rowsRemovedByPushdownCond}`,
      );
    }

    if (
      node.rowsRemovedByFilter !== undefined &&
      node.rowsRemovedByFilter > 0
    ) {
      let removedByFilterLabel: string;
      if (isScan && node.pushedDownFilter) {
        // When we have a separate pushdown counter, the filter
        // counter is unambiguously the row-by-row residual share.
        // Otherwise we keep the legacy combined label so existing
        // callers / tests / docs continue to read correctly.
        removedByFilterLabel =
          node.rowsRemovedByPushdownCond !== undefined
            ? "Rows Removed by Filter"
            : "Rows Removed by Pushdown Filter";
      } else {
        removedByFilterLabel = "Rows Removed by Filter";
      }
      lines.push(
        `${detailPad}${removedByFilterLabel}: ${node.rowsRemovedByFilter}`,
      );
    }
  }

  if (
    opts.analyze &&
    node.rowsRemovedByAggregateFilter !== undefined &&
    node.rowsRemovedByAggregateFilter > 0
  ) {
    lines.push(
      `${detailPad}Rows Removed by Aggregate Filter: ${node.rowsRemovedByAggregateFilter}`,
    );
  }

  if (
    opts.analyze &&
    node.rowsRemovedByInlineFilter !== undefined &&
    node.rowsRemovedByInlineFilter > 0
  ) {
    lines.push(
      `${detailPad}Rows Removed by Inline Filter: ${node.rowsRemovedByInlineFilter}`,
    );
  }
}

// Sort/group keys, the "whole-table aggregate" tag, produced columns, and
// aggregate descriptions — everything that describes the shape of the output.
function formatOutputShapingSection(
  node: ExplainNode,
  opts: ExplainOptions,
  detailPad: string,
  lines: string[],
  parentOutput?: ReadonlyArray<string>,
): void {
  if (node.sortKeys && node.sortKeys.length > 0) {
    const keyLabel =
      node.nodeType === "GroupAggregate"
        ? "Group Key"
        : node.sortType === "group"
          ? "Sort Key (Group)"
          : "Sort Key";
    lines.push(`${detailPad}${keyLabel}: ${node.sortKeys.join(", ")}`);
  }

  if (node.implicitGroup) {
    lines.push(`${detailPad}Grouping: whole-table aggregate`);
  }

  if (opts.verbose && node.outputColumns && node.outputColumns.length > 0) {
    if (parentOutput && outputColumnsEqual(parentOutput, node.outputColumns)) {
      lines.push(`${detailPad}Output: same`);
    } else {
      lines.push(`${detailPad}Output: ${node.outputColumns.join(", ")}`);
    }
  }

  if (opts.verbose && node.aggregates && node.aggregates.length > 0) {
    for (const agg of node.aggregates) {
      let desc = `${agg.name}(${agg.args})`;
      if (agg.filter) desc += ` filter(${agg.filter})`;
      if (agg.orderBy) desc += ` order by ${agg.orderBy}`;
      lines.push(`${detailPad}Aggregate: ${desc}`);
    }
  }
}

function formatOperatorStatsSection(
  node: ExplainNode,
  opts: ExplainOptions,
  detailPad: string,
  lines: string[],
): void {
  if (
    opts.analyze &&
    node.rowsRemovedByUnique !== undefined &&
    node.rowsRemovedByUnique > 0
  ) {
    lines.push(
      `${detailPad}Rows Removed by Unique: ${node.rowsRemovedByUnique}`,
    );
  }

  if (node.memoryRows !== undefined) {
    const suffix = node.hashBuildSide
      ? `  (build side: ${node.hashBuildSide})`
      : "";
    lines.push(`${detailPad}Memory: ${node.memoryRows} rows${suffix}`);
  }

  if (node.hashBuckets !== undefined) {
    lines.push(`${detailPad}Distinct Build Keys: ${node.hashBuckets}`);
  }
}

function formatSourceAndHintSection(
  node: ExplainNode,
  opts: ExplainOptions,
  detailPad: string,
  lines: string[],
): void {
  if (node.functionCall) {
    lines.push(`${detailPad}Function Call: ${node.functionCall}`);
  }

  if (node.hintUsed) {
    lines.push(`${detailPad}Join Hint: ${node.hintUsed}`);
  }

  if (opts.hints && node.sourceHints && node.sourceHints.length > 0) {
    lines.push(`${detailPad}Hints: ${node.sourceHints.join(", ")}`);
  }
}

function formatPushdownDetailSection(
  node: ExplainNode,
  detailPad: string,
  lines: string[],
): void {
  if (node.predicatePushdown) {
    lines.push(`${detailPad}Pushdown Capabilities: ${node.predicatePushdown}`);
  }

  if (node.normalizationState) {
    lines.push(`${detailPad}Normalization: ${node.normalizationState}`);
    if (node.originalPredicateExpr !== undefined) {
      lines.push(
        `${detailPad}Original Predicate: ${stripOuterParens(node.originalPredicateExpr)}`,
      );
    }
    if (node.normalizedPredicateExpr !== undefined) {
      lines.push(
        `${detailPad}Normalized Predicate: ${stripOuterParens(node.normalizedPredicateExpr)}`,
      );
    }
    lines.push(
      `${detailPad}Normalized Pushdown: ${stripOuterParens(node.normalizedPushdownExpr ?? "none")}`,
    );
    lines.push(
      `${detailPad}Normalized Leftover: ${stripOuterParens(node.normalizedLeftoverExpr ?? "none")}`,
    );
  }
}

function formatExecutionEngineSection(
  node: ExplainNode,
  opts: ExplainOptions,
  detailPad: string,
  lines: string[],
): void {
  if (node.executionScanKind) {
    lines.push(`${detailPad}Execution Scan: ${node.executionScanKind}`);
  }

  if (node.engineIds && node.engineIds.length > 0) {
    lines.push(`${detailPad}Engines: ${node.engineIds.join(", ")}`);
  }

  if (
    node.engineCapabilityBreakdown &&
    node.engineCapabilityBreakdown.length > 0
  ) {
    const blockIndent = `${detailPad}  `;
    for (const e of node.engineCapabilityBreakdown) {
      const headerParts: string[] = [];
      if (e.kind) headerParts.push(`kind=${e.kind}`);
      if (e.baseCostWeight !== undefined) {
        headerParts.push(`cost=${formatEngineCost(e.baseCostWeight)}`);
      }
      if (e.priority !== undefined) {
        headerParts.push(`priority=${e.priority}`);
      }
      const header =
        headerParts.length > 0
          ? `${detailPad}Engine: ${e.id}  (${headerParts.join(", ")})`
          : `${detailPad}Engine: ${e.id}`;
      lines.push(header);

      if (e.capabilities.length > 0) {
        lines.push(`${blockIndent}Capabilities: ${e.capabilities.join(", ")}`);
      }

      if (e.ownedColumns && e.ownedColumns.length > 0) {
        const ownsList = e.ownedColumns
          .map((vc) => `${vc.column}  (rows=${vc.rowCount} ndv=${vc.ndv})`)
          .join(", ");
        lines.push(`${blockIndent}Owns: ${ownsList}`);
      }

      // Per-engine runtime stats. Only rendered under EXPLAIN ANALYZE
      // (the plan-only EXPLAIN never has runtime stats to show); the
      // VERBOSE flag is already a precondition for entering this
      // function. Captured by the dispatcher from `EngineInstrumentation`
      // and flowed through `EngineDispatchReport` -> source.stats ->
      // `engineCapabilityBreakdown.runtimeStats`.
      if (opts.analyze) {
        const runtimeLine = formatEngineRuntimeStats(e);
        if (runtimeLine) {
          lines.push(`${blockIndent}Runtime: ${runtimeLine}`);
        }
      }
    }
  } else if (node.plannerCapabilities && node.plannerCapabilities.length > 0) {
    // Defensive fallback: a node carrying combined `plannerCapabilities`
    // but no per-engine breakdown (shouldn't happen for nodes built via
    // `buildExplainScanNode`, but kept for synthetic nodes constructed
    // by callers outside this module).
    lines.push(
      `${detailPad}Planner Capabilities: ${node.plannerCapabilities.join(", ")}`,
    );
  }
}

/**
 * Wall-clock duration (ms) of the source's pre-pass `query()` call,
 * if it was timed. Returns 0 when the source was not pre-passed (a
 * single-source path that runs inline) or when the timestamps are
 * not present (legacy collection that does not stamp them).
 *
 * Used by leaf-scan timing to extend the reported `actual time=`
 * window to cover the pre-pass duration -- without this, scans for
 * delegated sources show `0..0` while their engines inside report
 * non-zero `exec-time`, breaking parent>=child time monotonicity.
 */
function scanPrepassDurationMs(source: JoinSource): number {
  const start = source.stats?.prepassStartedAtMs;
  const end = source.stats?.prepassFinishedAtMs;
  if (start === undefined || end === undefined) return 0;
  return Math.max(0, end - start);
}

/**
 * Compare two `Output:` column lists for identity. Used to detect
 * the projection-pass-through case (Sort -> Project -> Unique etc.)
 * so EXPLAIN VERBOSE can render `Output: same` instead of repeating
 * the full list at every level (Postgres convention).
 */
function outputColumnsEqual(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Compact rendering for engine cost weights. Trims trailing zeros so
 * `0.6` does not show as `0.60` and `1` does not show as `1.0`, while
 * preserving precision for fractional values like `0.45`.
 */
function formatEngineCost(weight: number): string {
  if (Number.isInteger(weight)) return String(weight);
  return weight.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Render the per-engine `Runtime: ...` line for EXPLAIN ANALYZE.
 *
 * Composes `runtimeStats` (engine-reported counters) with `executeMs`
 * (dispatcher-measured wall-clock) into a single, deterministically
 * ordered list. Returns `undefined` when neither source has data so
 * the caller can omit the line cleanly.
 *
 * Display labels (post-rename, EXPLAIN-facing only -- the underlying
 * `EngineRuntimeStatKind` strings are unchanged so engine
 * implementations are unaffected):
 *
 *   - `op-time`     -- sum of explicitly-tracked operations the engine
 *                      timed via `beginOperation()` (e.g. `bitmap-match`).
 *                      May be SMALLER than `exec-time` when the engine
 *                      does work outside any timed operation. Was the
 *                      `time-ms` runtime stat.
 *   - `exec-time`   -- dispatcher's wall-clock around `engine.execute()`.
 *                      Always `>= op-time`. The number to compare against
 *                      sibling engines and against the parent scan's
 *                      `actual time=` window. Was `execute-ms`.
 *   - other `-ms`   -- engine-specific timing sub-counters now print
 *                      as `<name>-time` (e.g. `bitmap-population-time`)
 *                      so units are consistent across the line.
 *
 * Counter ordering: rows-examined, rows-returned, op-time, then
 * engine-specific sub-counters (cache, bitmap, io), with `exec-time`
 * last so the dispatcher's wall-clock anchor is the rightmost number.
 */
function formatEngineRuntimeStats(engine: {
  runtimeStats?: Partial<Record<string, number>>;
  executeMs?: number;
}): string | undefined {
  const parts: string[] = [];
  const stats = engine.runtimeStats ?? {};
  const order = [
    "rows-examined",
    "rows-returned",
    "time-ms",
    "cache-hits",
    "cache-misses",
    "bitmap-population-ms",
    "bitmap-intersection-ms",
    "io-bytes-read",
  ];
  for (const k of order) {
    const v = stats[k];
    if (v === undefined) continue;
    const displayKey = renameRuntimeStatKey(k);
    if (k.endsWith("-ms")) {
      parts.push(`${displayKey}=${v.toFixed(3)}`);
    } else {
      parts.push(`${displayKey}=${v}`);
    }
  }
  if (engine.executeMs !== undefined) {
    parts.push(`exec-time=${engine.executeMs.toFixed(3)}`);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/**
 * Map an `EngineRuntimeStatKind` (internal) to its EXPLAIN display
 * label. Drops the redundant `-ms` suffix on time stats (the
 * preceding identifier already conveys "time") and renames
 * `time-ms` to the more-descriptive `op-time` (sum of beginOperation
 * windows) so it visually contrasts with `exec-time` (the
 * dispatcher's wall-clock around the whole `engine.execute()`).
 */
function renameRuntimeStatKey(kind: string): string {
  if (kind === "time-ms") return "op-time";
  if (kind.endsWith("-ms")) return `${kind.slice(0, -3)}-time`;
  return kind;
}

function formatPlannerEstimationSection(
  node: ExplainNode,
  detailPad: string,
  lines: string[],
): void {
  if (node.selectivity !== undefined) {
    const sel = node.selectivity;
    const formatted =
      sel >= 0.01
        ? sel.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".0")
        : sel.toPrecision(3);
    lines.push(`${detailPad}Selectivity: ${formatted}`);

    // Provenance: how the selectivity was computed and from which
    // inputs. Renders as a follow-up `Selectivity Source:` line so
    // readers do not have to reverse-engineer the formula from the
    // surrounding NDV / MCV lines. Post-#7 fix.
    if (node.selectivityTrace) {
      const t = node.selectivityTrace;
      const parts: string[] = [t.source];
      if (t.leftNdv !== undefined && t.rightNdv !== undefined) {
        parts.push(`leftNdv=${t.leftNdv}`);
        parts.push(`rightNdv=${t.rightNdv}`);
      }
      if (t.leftMcvKeys !== undefined && t.rightMcvKeys !== undefined) {
        parts.push(`leftMcv=${t.leftMcvKeys}`);
        parts.push(`rightMcv=${t.rightMcvKeys}`);
      }
      if (t.rangeMultiplier !== undefined) {
        parts.push(`range=${t.rangeMultiplier.toPrecision(3)}`);
      }
      lines.push(`${detailPad}Selectivity Source: ${parts.join(", ")}`);
    }
  }

  if (node.statsSource) {
    lines.push(`${detailPad}Stats: ${node.statsSource}`);
  }

  if (node.ndvSource && node.joinKeyNdv) {
    const l = node.joinKeyNdv;
    const fmtNdv = (n: number) => (n < 0 ? "n/a" : String(n));
    lines.push(
      `${detailPad}NDV: ${node.ndvSource}  (values ${l.left}=${fmtNdv(l.leftNdv)} ${l.right}=${fmtNdv(l.rightNdv)})`,
    );
  } else if (node.ndvSource) {
    lines.push(`${detailPad}NDV: ${node.ndvSource}`);
  }

  if (node.mcvUsed) {
    const suffix =
      node.mcvKeyCount !== undefined ? `  (keys=${node.mcvKeyCount})` : "";
    lines.push(`${detailPad}MCV: both sides${suffix}`);
  } else if (node.mcvFallback === "one-sided") {
    const suffix =
      node.mcvKeyCount !== undefined ? `  (keys=${node.mcvKeyCount})` : "";
    lines.push(`${detailPad}MCV: single side${suffix}`);
  } else if (node.mcvFallback === "suppressed") {
    const suffix =
      node.mcvKeyCount !== undefined ? `  (keys=${node.mcvKeyCount})` : "";
    lines.push(`${detailPad}MCV: suppressed${suffix}`);
  } else if (node.mcvFallback === "no-mcv") {
    lines.push(`${detailPad}MCV: not available`);
  }
}

function joinTypeSegment(joinType: JoinType | undefined): string {
  if (!joinType || joinType === "inner") return "";
  switch (joinType) {
    case "semi":
      return " Semi";
    case "anti":
      return " Anti";
    default: {
      const _exhaustive: never = joinType;
      return _exhaustive;
    }
  }
}

function formatHashMergeJoinLabel(
  method: "hash" | "merge",
  joinType: JoinType | undefined,
): string {
  const kind = method === "hash" ? "Hash" : "Merge";
  if (!joinType || joinType === "inner") {
    return `${kind} Join`;
  }
  return `${kind}${joinTypeSegment(joinType)} Join`;
}

function formatNestedLoopJoinLabel(joinType: JoinType | undefined): string {
  if (!joinType || joinType === "inner") {
    return "Nested Loop";
  }
  return `Nested Loop${joinTypeSegment(joinType)} Join`;
}

function formatScanNodeLabel(node: ExplainNode): string {
  const src = node.source ?? "?";
  const k = node.executionScanKind;
  if (k === "index") {
    return `Index Only Scan on ${src}`;
  }
  if (k === "bitmap") {
    return `Index Scan on ${src}`;
  }
  return `Seq Scan on ${src}`;
}

function formatNodeLabel(node: ExplainNode): string {
  switch (node.nodeType) {
    case "Scan":
      return formatScanNodeLabel(node);
    case "FunctionScan":
      return `Function Seq Scan on ${node.source ?? "?"}`;
    case "Filter":
      return "Filter";
    case "HashJoin":
      return formatHashMergeJoinLabel("hash", node.joinType);
    case "NestedLoop":
      return formatNestedLoopJoinLabel(node.joinType);
    case "MergeJoin":
      return formatHashMergeJoinLabel("merge", node.joinType);
    case "Sort":
      return node.sortType === "group" ? "Sort (Group)" : "Sort";
    case "Limit":
      return "Limit";
    case "GroupAggregate":
      if (node.implicitGroup) {
        return "Implicit Group Aggregation";
      }
      if (node.sortKeys && node.sortKeys.length > 0) {
        return "Hash Aggregate";
      }
      return "Group Aggregation";
    case "Unique":
      return "Unique";
    case "Project":
      return "Project";
    default:
      return node.nodeType;
  }
}

function assignResidualPredicatesToLowestCoveringJoin(
  tree: JoinNode,
  expr: LuaExpression,
  equiPreds?: EquiPredicate[],
): void {
  const allSourceNames = collectSourceNames(tree);
  const conjuncts = flattenAnd(expr);

  for (const conjunct of conjuncts) {
    if (exprMatchesEquiPred(conjunct, equiPreds ?? [])) {
      continue;
    }

    const refs = collectReferencedSources(conjunct, allSourceNames);

    if (refs.size < 2) {
      continue;
    }

    assignResidualPredicateToLowestCoveringJoin(tree, conjunct, refs);
  }
}

function assignResidualPredicateToLowestCoveringJoin(
  node: JoinNode,
  predicate: LuaExpression,
  refs: Set<string>,
): boolean {
  if (node.kind === "leaf") {
    return false;
  }

  const leftSources = collectSourceNames(node.left);
  const rightSources = collectSourceNames(node.right);

  const leftCoversAll = isSubsetOf(refs, leftSources);
  const rightCoversAll = isSubsetOf(refs, rightSources);

  if (leftCoversAll) {
    return assignResidualPredicateToLowestCoveringJoin(
      node.left,
      predicate,
      refs,
    );
  }
  if (rightCoversAll) {
    return assignResidualPredicateToLowestCoveringJoin(
      node.right,
      predicate,
      refs,
    );
  }

  if (!node.joinResiduals) {
    node.joinResiduals = [];
  }

  if (!node.joinResiduals.some((r) => exprStructurallyEquals(r, predicate))) {
    node.joinResiduals.push(predicate);
  }

  return true;
}

function isSubsetOf(
  values: Set<string>,
  candidateSuperset: Set<string>,
): boolean {
  for (const value of values) {
    if (!candidateSuperset.has(value)) {
      return false;
    }
  }
  return true;
}

export function joinPlannerConfigFromConfig(config: Config): JoinPlannerConfig {
  return {
    watchdogLimit:
      config.get("queryPlanner.watchdogLimit", undefined) ?? undefined,
    yieldChunk: config.get("queryPlanner.yieldChunk", undefined) ?? undefined,
    smallTableThreshold:
      config.get("queryPlanner.smallTableThreshold", undefined) ?? undefined,
    mergeJoinThreshold:
      config.get("queryPlanner.mergeJoinThreshold", undefined) ?? undefined,
    widthWeight: config.get("queryPlanner.widthWeight", undefined) ?? undefined,
    candidateWidthWeight:
      config.get("queryPlanner.candidateWidthWeight", undefined) ?? undefined,
    semiAntiLoopDiscount:
      config.get("queryPlanner.semiAntiLoopDiscount", undefined) ?? undefined,
    partialStatsConfidence:
      config.get("queryPlanner.partialStatsConfidence", undefined) ?? undefined,
    approximateStatsConfidence:
      config.get("queryPlanner.approximateStatsConfidence", undefined) ??
      undefined,
    bitmapScanPenalty:
      config.get("queryPlanner.bitmapScanPenalty", undefined) ?? undefined,
    indexScanNoPushdownPenalty:
      config.get("queryPlanner.indexScanNoPushdownPenalty", undefined) ??
      undefined,
    kvScanPenalty:
      config.get("queryPlanner.kvScanPenalty", undefined) ?? undefined,
    defaultFilterSelectivity:
      config.get("queryPlanner.defaultFilterSelectivity", undefined) ??
      undefined,
    defaultDistinctSurvivalRatio:
      config.get("queryPlanner.defaultDistinctSurvivalRatio", undefined) ??
      undefined,
    defaultRangeSelectivity:
      config.get("queryPlanner.defaultRangeSelectivity", undefined) ??
      undefined,
    inferredNdvDivisor:
      config.get("queryPlanner.inferredNdvDivisor", undefined) ?? undefined,
  };
}
