/**
 * Predicate dispatcher: the planner-side orchestrator that asks every
 * registered engine to claim a sub-tree of a `BoundPredicate`, executes
 * the claims, and combines the results into a single id-set the caller
 * uses to narrow its row source.
 */
import type {
  BoundPredicate,
  EngineInstrumentation,
  EnginePlanResult,
  EngineRuntimeStatKind,
  EngineSpec,
  PlanContext,
  QueryEngine,
} from "./engine_contract.ts";

/**
 * Outcome of a dispatcher run:
 *
 *   - `narrowed`: at least one engine claimed and produced an id-set.
 *
 *      The caller resolves these ids via the appropriate engine and
 *      passes them to `applyQuery`;
 *
 *   - `no-claim`: no engine claimed, OR all claims declined at
 *      execute time.
 *
 *      The caller falls back to a full relation scan.
 */
export type DispatchResult =
  | {
      kind: "narrowed";
      relation: string;
      ids: Set<number>;
      // Per-engine plan/exec records, in plan order. Used by EXPLAIN
      // rendering and post-mortem stats.
      runs: DispatchRun[];
    }
  | {
      kind: "no-claim";
      // Engines that claimed but DECLINED at execute time. Rare; only
      // happens when an engine snapshot loses validity (e.g. bitmap
      // trust changes mid-flight). Surfaced in EXPLAIN VERBOSE so the
      // failure mode is observable.
      declined: DispatchRun[];
    };

/**
 * Per-engine execution record. The dispatcher emits one `DispatchRun`
 * per engine that successfully ran (whether the result was used or
 * declined). The fields mirror what EXPLAIN / EXPLAIN ANALYZE need:
 * engine identity, the claimed predicate sub-tree, and (eventually)
 * runtime stats for that dispatch.
 */
export type DispatchRun = {
  spec: EngineSpec;
  plan: EnginePlanResult;
  // True when `execute()` returned a usable id-set. False when
  // the engine declined.
  contributed: boolean;
  // Reason the engine declined, when `contributed` is false.
  declineReason?: string;
  // Number of ids the engine returned when it contributed.
  rowsReturned?: number;
  // Runtime stats the engine emitted via `EngineInstrumentation`
  // during this dispatch. Empty when the engine emitted nothing.
  runtimeStats?: Partial<Record<EngineRuntimeStatKind, number>>;
  // Wall-clock duration of `execute()` in milliseconds. Always
  // populated when `execute()` ran. Distinct from `runtimeStats[time-ms]`.
  executeMs?: number;
};

export async function dispatchPredicate(
  pred: BoundPredicate | undefined,
  engines: ReadonlyArray<QueryEngine>,
  ctx: PlanContext,
  instrFor: (spec: EngineSpec) => EngineInstrumentation,
): Promise<DispatchResult> {
  const declined: DispatchRun[] = [];
  if (!pred) return { kind: "no-claim", declined };
  if (engines.length === 0) return { kind: "no-claim", declined };

  // Plan phase: ask every engine to claim a sub-tree
  const plans: { engine: QueryEngine; plan: EnginePlanResult }[] = [];
  for (const engine of engines) {
    const result = engine.plan(pred, ctx);
    if (result) plans.push({ engine, plan: result });
  }

  if (plans.length === 0) return { kind: "no-claim", declined };

  // Execute phase: dispatch each claim, intersect the resulting id-sets
  let intersected: Set<number> | undefined;
  let relation: string | undefined;
  const runs: DispatchRun[] = [];

  for (const { engine, plan } of plans) {
    const spec = engine.spec();
    const downstream = instrFor(spec);
    const { instr, capture } = makeCapturingInstrumentation(downstream);
    const startedAt = nowMs();
    const rs = await engine.execute(plan, instr);
    const executeMs = nowMs() - startedAt;
    const stats = capture();

    if (rs.kind === "declined") {
      declined.push({
        spec,
        plan,
        contributed: false,
        declineReason: rs.reason,
        runtimeStats: stats,
        executeMs,
      });
      continue;
    }

    if (rs.kind !== "ids") {
      declined.push({
        spec,
        plan,
        contributed: false,
        declineReason: `unsupported-rowset-kind:${(rs as { kind: string }).kind}`,
        runtimeStats: stats,
        executeMs,
      });
      continue;
    }

    runs.push({
      spec,
      plan,
      contributed: true,
      rowsReturned: rs.ids.size,
      runtimeStats: stats,
      executeMs,
    });

    if (intersected === undefined) {
      intersected = rs.ids;
      relation = rs.relation;
    } else {
      const next = new Set<number>();
      for (const id of intersected) {
        if (rs.ids.has(id)) next.add(id);
      }
      intersected = next;
    }
  }

  // If every claim declined at execute time, surface as `no-claim` with
  // the decline trail so the caller falls back to a full scan
  if (intersected === undefined) {
    return { kind: "no-claim", declined };
  }

  // Append declines to runs so EXPLAIN VERBOSE can show them inline
  for (const d of declined) runs.push(d);

  return {
    kind: "narrowed",
    relation: relation!,
    ids: intersected,
    runs,
  };
}

/**
 * Build a no-op `EngineInstrumentation`. The dispatcher always wraps
 * whatever instrumentation it is handed in `makeCapturingInstrumentation`
 * so per-engine stats end up on each `DispatchRun`; callers that have
 * nothing else to do with the stats can pass this no-op as the
 * downstream sink.
 */
export function noopInstrumentation(): EngineInstrumentation {
  return {
    recordStat() {},
    beginOperation() {
      return () => {};
    },
    recordEvent() {},
  };
}

function makeCapturingInstrumentation(downstream: EngineInstrumentation): {
  instr: EngineInstrumentation;
  capture: () => Partial<Record<EngineRuntimeStatKind, number>>;
} {
  const totals: Partial<Record<EngineRuntimeStatKind, number>> = {};
  const accumulate = (kind: EngineRuntimeStatKind, value: number) => {
    totals[kind] = (totals[kind] ?? 0) + value;
  };
  return {
    instr: {
      recordStat(kind, value) {
        accumulate(kind, value);
        downstream.recordStat(kind, value);
      },
      beginOperation(label) {
        const startedAt = nowMs();
        const downstreamEnd = downstream.beginOperation(label);
        return () => {
          accumulate("time-ms", nowMs() - startedAt);
          downstreamEnd();
        };
      },
      recordEvent(label, detail) {
        downstream.recordEvent(label, detail);
      },
    },
    capture: () => totals,
  };
}

function nowMs(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}
