import { describe, expect, it } from "vitest";
import {
  dispatchPredicate,
  noopInstrumentation,
} from "./dispatch_predicate.ts";
import { bindPredicate } from "./bind_predicate.ts";
import { parseExpressionString } from "./parse.ts";
import type {
  BoundPredicate,
  EnginePlanResult,
  EngineRowSet,
  EngineSpec,
  PlanContext,
  QueryEngine,
} from "./engine_contract.ts";

// We synthesise lightweight QueryEngine instances so we can drive the
// dispatcher's edge cases (claim, decline, refuse, intersect) without
// standing up a real ObjectIndex/Augmenter.

interface MockEngineConfig {
  id: string;
  // What the engine claims when asked to plan(). `null` means "refuse to plan".
  claim?: BoundPredicate | "self";
  // What execute() returns. Defaults to `{ kind: "ids", ids }`.
  rowSet?: EngineRowSet;
  ids?: number[];
  // Override the spec relation (defaults to `"page"`).
  relation?: string;
  // Priority, defaults to 20.
  priority?: number;
}

function mockEngine(cfg: MockEngineConfig): QueryEngine {
  const spec: EngineSpec = {
    id: cfg.id,
    name: cfg.id,
    kind: "index",
    relation: cfg.relation ?? "page",
    columns: [],
    composites: ["and"],
    baseCostWeight: 0.5,
    priority: cfg.priority ?? 20,
    globalStatsKinds: [],
    runtimeStatsKinds: [],
  };

  return {
    spec: () => spec,
    plan(pred): EnginePlanResult | null {
      if (cfg.claim === undefined) return null;
      const claimed: BoundPredicate = cfg.claim === "self" ? pred : cfg.claim;
      return {
        claimed,
        residual: null,
        estimatedCost: 1,
        estimatedRows: 100,
        handle: { id: cfg.id },
      };
    },
    async execute(): Promise<EngineRowSet> {
      if (cfg.rowSet) return cfg.rowSet;
      return {
        kind: "ids",
        relation: spec.relation,
        ids: new Set(cfg.ids ?? []),
      };
    },
    getColumnStats: () => undefined,
  };
}

function bind(where: string, relation = "p"): BoundPredicate {
  const expr = parseExpressionString(where);
  const bound = bindPredicate(expr, relation);
  if (!bound) throw new Error("bindPredicate returned undefined");
  return bound;
}

function ctx(overrides: Partial<PlanContext> = {}): PlanContext {
  return {
    phase: "source-leaf",
    smallSetThreshold: 100,
    peerEngines: [],
    ...overrides,
  };
}

const instrFor = () => noopInstrumentation();

// dispatch behaviour

describe("dispatchPredicate -- no-claim paths", () => {
  it("returns no-claim when predicate is undefined", async () => {
    const result = await dispatchPredicate(
      undefined,
      [mockEngine({ id: "e1", claim: "self", ids: [1, 2] })],
      ctx(),
      instrFor,
    );
    expect(result.kind).toBe("no-claim");
  });

  it("returns no-claim when no engines are registered", async () => {
    const result = await dispatchPredicate(
      bind("p.tag == 'page'"),
      [],
      ctx(),
      instrFor,
    );
    expect(result.kind).toBe("no-claim");
  });

  it("returns no-claim when every engine refuses to plan", async () => {
    const result = await dispatchPredicate(
      bind("p.tag == 'page'"),
      [
        mockEngine({ id: "e1" }), // claim undefined => null plan
        mockEngine({ id: "e2" }),
      ],
      ctx(),
      instrFor,
    );
    expect(result.kind).toBe("no-claim");
    if (result.kind !== "no-claim") throw new Error("unreachable");
    expect(result.declined).toEqual([]);
  });
});

describe("dispatchPredicate -- single-engine claim", () => {
  it("returns narrowed with the engine's id-set", async () => {
    const result = await dispatchPredicate(
      bind("p.tag == 'page'"),
      [mockEngine({ id: "bm", claim: "self", ids: [1, 5, 9] })],
      ctx(),
      instrFor,
    );
    expect(result.kind).toBe("narrowed");
    if (result.kind !== "narrowed") throw new Error("unreachable");
    expect([...result.ids].sort()).toEqual([1, 5, 9]);
    expect(result.relation).toBe("page");
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].contributed).toBe(true);
    expect(result.runs[0].rowsReturned).toBe(3);
  });
});

describe("dispatchPredicate -- multiple-engine claims", () => {
  it("intersects id-sets across engines", async () => {
    const result = await dispatchPredicate(
      bind("p.tag == 'page'"),
      [
        mockEngine({ id: "bm", claim: "self", ids: [1, 2, 3, 4] }),
        mockEngine({ id: "aug", claim: "self", ids: [2, 3, 5] }),
      ],
      ctx(),
      instrFor,
    );
    expect(result.kind).toBe("narrowed");
    if (result.kind !== "narrowed") throw new Error("unreachable");
    expect([...result.ids].sort()).toEqual([2, 3]);
    expect(result.runs.filter((r) => r.contributed)).toHaveLength(2);
  });

  it("intersection becomes empty when claims disjoint", async () => {
    const result = await dispatchPredicate(
      bind("p.tag == 'page'"),
      [
        mockEngine({ id: "bm", claim: "self", ids: [1, 2] }),
        mockEngine({ id: "aug", claim: "self", ids: [10, 20] }),
      ],
      ctx(),
      instrFor,
    );
    expect(result.kind).toBe("narrowed");
    if (result.kind !== "narrowed") throw new Error("unreachable");
    expect(result.ids.size).toBe(0);
  });
});

describe("dispatchPredicate -- decline handling", () => {
  it("ignores declined engines but uses peers' results", async () => {
    const result = await dispatchPredicate(
      bind("p.tag == 'page'"),
      [
        mockEngine({
          id: "bm",
          claim: "self",
          rowSet: { kind: "declined", reason: "untrusted-mid-flight" },
        }),
        mockEngine({ id: "aug", claim: "self", ids: [1, 2, 3] }),
      ],
      ctx(),
      instrFor,
    );
    expect(result.kind).toBe("narrowed");
    if (result.kind !== "narrowed") throw new Error("unreachable");
    expect([...result.ids].sort()).toEqual([1, 2, 3]);

    const declined = result.runs.filter((r) => !r.contributed);
    expect(declined).toHaveLength(1);
    expect(declined[0].declineReason).toBe("untrusted-mid-flight");
  });

  it("returns no-claim with decline trail when ALL claims decline", async () => {
    const result = await dispatchPredicate(
      bind("p.tag == 'page'"),
      [
        mockEngine({
          id: "bm",
          claim: "self",
          rowSet: { kind: "declined", reason: "r1" },
        }),
        mockEngine({
          id: "aug",
          claim: "self",
          rowSet: { kind: "declined", reason: "r2" },
        }),
      ],
      ctx(),
      instrFor,
    );
    expect(result.kind).toBe("no-claim");
    if (result.kind !== "no-claim") throw new Error("unreachable");
    expect(result.declined).toHaveLength(2);
    expect(result.declined.map((r) => r.declineReason)).toEqual(["r1", "r2"]);
  });

  it("treats `rows` row-sets as decline", async () => {
    const result = await dispatchPredicate(
      bind("p.tag == 'page'"),
      [
        mockEngine({
          id: "compute",
          claim: "self",
          rowSet: { kind: "rows", rows: [{ x: 1 }] },
        }),
      ],
      ctx(),
      instrFor,
    );
    expect(result.kind).toBe("no-claim");
    if (result.kind !== "no-claim") throw new Error("unreachable");
    expect(result.declined[0].declineReason).toBe(
      "unsupported-rowset-kind:rows",
    );
  });
});

describe("dispatchPredicate -- run ordering and stats", () => {
  it("preserves engine order in runs[] (contributors first, declines after)", async () => {
    const result = await dispatchPredicate(
      bind("p.tag == 'page'"),
      [
        mockEngine({
          id: "first-decline",
          claim: "self",
          rowSet: { kind: "declined", reason: "x" },
        }),
        mockEngine({ id: "ok-1", claim: "self", ids: [1, 2, 3] }),
        mockEngine({ id: "ok-2", claim: "self", ids: [2, 3, 4] }),
      ],
      ctx(),
      instrFor,
    );
    expect(result.kind).toBe("narrowed");
    if (result.kind !== "narrowed") throw new Error("unreachable");
    // Contributors come first (in plan order), declines appended.
    expect(result.runs.map((r) => r.spec.id)).toEqual([
      "ok-1",
      "ok-2",
      "first-decline",
    ]);
  });

  it("captures per-engine runtime stats from EngineInstrumentation into DispatchRun.runtimeStats", async () => {
    // Custom engine that emits stats during execute().
    const recordingEngine: QueryEngine = {
      spec: () => ({
        id: "recording-engine",
        name: "recording-engine",
        kind: "index",
        relation: "page",
        columns: [],
        composites: ["and"],
        baseCostWeight: 0.5,
        priority: 20,
        globalStatsKinds: [],
        runtimeStatsKinds: ["rows-examined", "rows-returned", "time-ms"],
      }),
      plan: (pred) => ({
        claimed: pred,
        residual: null,
        estimatedCost: 1,
        estimatedRows: 1,
        handle: {},
      }),
      async execute(_plan, instr) {
        instr.recordStat("rows-examined", 100);
        instr.recordStat("rows-examined", 50);
        instr.recordStat("rows-returned", 7);
        const end = instr.beginOperation("inner");
        // Force a measurable elapsed time via micro-task delay.
        await new Promise((r) => setTimeout(r, 1));
        end();
        return { kind: "ids", relation: "page", ids: new Set([1, 2, 3]) };
      },
      getColumnStats: () => undefined,
    };

    const result = await dispatchPredicate(
      bind("p.tag == 'page'"),
      [recordingEngine],
      ctx(),
      instrFor,
    );

    expect(result.kind).toBe("narrowed");
    if (result.kind !== "narrowed") throw new Error("unreachable");
    const run = result.runs[0];
    expect(run.runtimeStats).toBeDefined();
    // Counters are summed across multiple recordStat calls.
    expect(run.runtimeStats?.["rows-examined"]).toBe(150);
    expect(run.runtimeStats?.["rows-returned"]).toBe(7);
    // beginOperation/end emits accumulated `time-ms` >= 0.
    expect(run.runtimeStats?.["time-ms"]).toBeDefined();
    expect(run.runtimeStats!["time-ms"]!).toBeGreaterThanOrEqual(0);
    // Wall-clock executeMs is always populated.
    expect(run.executeMs).toBeGreaterThanOrEqual(0);
  });

  it("forwards stats to the downstream instrumentation while still capturing locally", async () => {
    const downstreamCalls: { kind: string; value: number }[] = [];
    const downstream = () => ({
      recordStat(kind: any, value: number) {
        downstreamCalls.push({ kind, value });
      },
      beginOperation: () => () => {},
      recordEvent: () => {},
    });

    const recordingEngine: QueryEngine = {
      spec: () => ({
        id: "rec",
        name: "rec",
        kind: "index",
        relation: "page",
        columns: [],
        composites: ["and"],
        baseCostWeight: 0.5,
        priority: 20,
        globalStatsKinds: [],
        runtimeStatsKinds: ["rows-examined"],
      }),
      plan: (pred) => ({
        claimed: pred,
        residual: null,
        estimatedCost: 1,
        estimatedRows: 1,
        handle: {},
      }),
      async execute(_plan, instr) {
        instr.recordStat("rows-examined", 42);
        return { kind: "ids", relation: "page", ids: new Set([1]) };
      },
      getColumnStats: () => undefined,
    };

    const result = await dispatchPredicate(
      bind("p.tag == 'page'"),
      [recordingEngine],
      ctx(),
      downstream,
    );

    expect(result.kind).toBe("narrowed");
    if (result.kind !== "narrowed") throw new Error("unreachable");
    // Captured locally on DispatchRun.
    expect(result.runs[0].runtimeStats?.["rows-examined"]).toBe(42);
    // Forwarded to the downstream sink.
    expect(downstreamCalls).toEqual([{ kind: "rows-examined", value: 42 }]);
  });

  it("captures stats even when the engine declines at execute time", async () => {
    const decliningEngine: QueryEngine = {
      spec: () => ({
        id: "decline-recorder",
        name: "decline-recorder",
        kind: "index",
        relation: "page",
        columns: [],
        composites: ["and"],
        baseCostWeight: 0.5,
        priority: 20,
        globalStatsKinds: [],
        runtimeStatsKinds: ["rows-examined"],
      }),
      plan: (pred) => ({
        claimed: pred,
        residual: null,
        estimatedCost: 1,
        estimatedRows: 1,
        handle: {},
      }),
      async execute(_plan, instr) {
        instr.recordStat("rows-examined", 5);
        return { kind: "declined", reason: "snapshot-stale" };
      },
      getColumnStats: () => undefined,
    };

    const result = await dispatchPredicate(
      bind("p.tag == 'page'"),
      [decliningEngine],
      ctx(),
      instrFor,
    );
    expect(result.kind).toBe("no-claim");
    if (result.kind !== "no-claim") throw new Error("unreachable");
    expect(result.declined[0].runtimeStats?.["rows-examined"]).toBe(5);
    expect(result.declined[0].declineReason).toBe("snapshot-stale");
    expect(result.declined[0].executeMs).toBeGreaterThanOrEqual(0);
  });
});
