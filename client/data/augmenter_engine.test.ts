import { describe, expect, it } from "vitest";
import {
  AugmenterEngine,
  type AugmenterEngineHost,
  type AugmenterEngineHostSnapshot,
} from "./augmenter_engine.ts";
import type { AugmenterMatchPredicate } from "./data_augmenter.ts";
import { bindPredicate } from "../space_lua/bind_predicate.ts";
import { parseExpressionString } from "../space_lua/parse.ts";
import type {
  BoundPredicate,
  EngineInstrumentation,
  PlanContext,
} from "../space_lua/engine_contract.ts";

interface MockHostState {
  snapshot: AugmenterEngineHostSnapshot;
  matchResult: { cacheKeys: Set<string>; needsUniverse: boolean } | undefined;
  keyToId: Map<string, number>;
  universeIds: number[];
  dispatches: AugmenterMatchPredicate[][];
  lookupCalls: ReadonlySet<string>[];
  universeCalls: number;
}

function makeHost(partial: Partial<AugmenterEngineHostSnapshot> = {}): {
  host: AugmenterEngineHost;
  state: MockHostState;
} {
  const snapshot: AugmenterEngineHostSnapshot = {
    tagName: "p",
    loaded: true,
    cacheSize: 4,
    columns: [
      { name: "lastAccessed", rowCount: 3, ndv: 3 },
      { name: "lastRun", rowCount: 1, ndv: 1 },
    ],
    ...partial,
  };
  const state: MockHostState = {
    snapshot,
    matchResult: { cacheKeys: new Set(), needsUniverse: false },
    keyToId: new Map([
      ["page-a", 1],
      ["page-b", 2],
      ["page-c", 3],
    ]),
    universeIds: [1, 2, 3, 4, 5],
    dispatches: [],
    lookupCalls: [],
    universeCalls: 0,
  };
  const host: AugmenterEngineHost = {
    snapshot: () => state.snapshot,
    matchPredicates: (preds) => {
      state.dispatches.push(preds);
      return state.matchResult;
    },
    lookupObjectIdsByKeys: async (refs) => {
      state.lookupCalls.push(refs);
      const ids: number[] = [];
      for (const ref of refs) {
        const id = state.keyToId.get(ref);
        if (id !== undefined) ids.push(id);
      }
      return ids;
    },
    allObjectIdsForTag: async () => {
      state.universeCalls++;
      return state.universeIds;
    },
    cachedKeys: () => state.keyToId.keys(),
  };
  return { host, state };
}

function makeInstr(): {
  instr: EngineInstrumentation;
  stats: Record<string, number>;
  events: { label: string; detail?: any }[];
  operations: string[];
} {
  const stats: Record<string, number> = {};
  const events: { label: string; detail?: any }[] = [];
  const operations: string[] = [];
  const instr: EngineInstrumentation = {
    recordStat(kind, value) {
      stats[kind] = (stats[kind] ?? 0) + value;
    },
    beginOperation(label) {
      operations.push(label);
      return () => {};
    },
    recordEvent(label, detail) {
      events.push({ label, detail });
    },
  };
  return { instr, stats, events, operations };
}

function planCtx(overrides: Partial<PlanContext> = {}): PlanContext {
  return {
    phase: "source-leaf",
    smallSetThreshold: 100,
    peerEngines: [],
    ...overrides,
  };
}

function bind(where: string, relation = "p"): BoundPredicate {
  const expr = parseExpressionString(where);
  const bound = bindPredicate(expr, relation);
  if (!bound) throw new Error(`bindPredicate returned undefined: ${where}`);
  return bound;
}

// spec()

describe("AugmenterEngine.spec", () => {
  it("advertises augmenter-overlay-<tag> with overlay kind and priority 25", async () => {
    const { host } = makeHost();
    const engine = await AugmenterEngine.create(host);
    const spec = engine.spec();
    expect(spec.id).toBe("augmenter-overlay-p");
    expect(spec.kind).toBe("overlay");
    expect(spec.relation).toBe("p");
    expect(spec.priority).toBe(25);
    expect(spec.baseCostWeight).toBe(0.4);
    expect(spec.composites).toEqual(["and"]);
  });

  it("advertises eq/neq/lt/lte/gt/gte/is-nil/is-not-nil per owned column", async () => {
    const { host } = makeHost();
    const engine = await AugmenterEngine.create(host);
    const cols = engine.spec().columns;
    expect(cols.map((c) => c.name).sort()).toEqual(["lastAccessed", "lastRun"]);
    for (const col of cols) {
      expect(col.predicateKinds.sort()).toEqual(
        ["eq", "gt", "gte", "is-nil", "is-not-nil", "lt", "lte", "neq"].sort(),
      );
      expect(col.valueKinds).toEqual(["literal"]);
      expect(col.statsKinds).toEqual(["ndv"]);
    }
  });

  it("flags loaded=false in metadata when augmenter is not loaded", async () => {
    const { host } = makeHost({ loaded: false });
    const engine = await AugmenterEngine.create(host);
    expect(engine.spec().metadata?.loaded).toBe(false);
  });
});

// plan()

describe("AugmenterEngine.plan", () => {
  it("returns null when augmenter is not loaded", async () => {
    const { host } = makeHost({ loaded: false });
    const engine = await AugmenterEngine.create(host);
    const result = engine.plan(
      bind("p.lastAccessed > '2026-01-01'"),
      planCtx(),
    );
    expect(result).toBeNull();
  });

  it("returns null when there are zero owned columns", async () => {
    const { host } = makeHost({ columns: [] });
    const engine = await AugmenterEngine.create(host);
    const result = engine.plan(
      bind("p.lastAccessed > '2026-01-01'"),
      planCtx(),
    );
    expect(result).toBeNull();
  });

  it("claims a value-comparison leaf on an owned column", async () => {
    const { host } = makeHost();
    const engine = await AugmenterEngine.create(host);
    const result = engine.plan(
      bind("p.lastAccessed > '2026-01-01'"),
      planCtx(),
    );
    expect(result).not.toBeNull();
    const handle = result!.handle as { preds: AugmenterMatchPredicate[] };
    expect(handle.preds).toEqual([
      { kind: "gt", column: "lastAccessed", value: "2026-01-01" },
    ]);
    expect(result!.residual).toBeNull();
  });

  it("claims `p.col == nil` as is-nil (after bind normalisation)", async () => {
    const { host } = makeHost();
    const engine = await AugmenterEngine.create(host);
    const result = engine.plan(bind("p.lastAccessed == nil"), planCtx());
    expect(result).not.toBeNull();
    const handle = result!.handle as { preds: AugmenterMatchPredicate[] };
    expect(handle.preds).toEqual([{ kind: "is-nil", column: "lastAccessed" }]);
  });

  it("claims `p.col ~= nil` as is-not-nil", async () => {
    const { host } = makeHost();
    const engine = await AugmenterEngine.create(host);
    const result = engine.plan(bind("p.lastAccessed ~= nil"), planCtx());
    expect(result).not.toBeNull();
    const handle = result!.handle as { preds: AugmenterMatchPredicate[] };
    expect(handle.preds).toEqual([
      { kind: "is-not-nil", column: "lastAccessed" },
    ]);
  });

  it("claims bare `p.col` as is-not-nil (truthiness check)", async () => {
    const { host } = makeHost();
    const engine = await AugmenterEngine.create(host);
    const result = engine.plan(bind("p.lastAccessed"), planCtx());
    expect(result).not.toBeNull();
    const handle = result!.handle as { preds: AugmenterMatchPredicate[] };
    expect(handle.preds).toEqual([
      { kind: "is-not-nil", column: "lastAccessed" },
    ]);
  });

  it("claims `not p.col` as is-nil", async () => {
    const { host } = makeHost();
    const engine = await AugmenterEngine.create(host);
    const result = engine.plan(bind("not p.lastAccessed"), planCtx());
    expect(result).not.toBeNull();
    const handle = result!.handle as { preds: AugmenterMatchPredicate[] };
    expect(handle.preds).toEqual([{ kind: "is-nil", column: "lastAccessed" }]);
  });

  it("claims AND-of-leaves and leaves the residual untouched", async () => {
    const { host } = makeHost();
    const engine = await AugmenterEngine.create(host);
    // `p.lastAccessed > 'X'` is claimable; `p.tag == 'page'` is not
    // (column not owned).
    const result = engine.plan(
      bind("p.lastAccessed > '2026-01-01' and p.tag == 'page'"),
      planCtx(),
    );
    expect(result).not.toBeNull();
    const handle = result!.handle as { preds: AugmenterMatchPredicate[] };
    expect(handle.preds).toEqual([
      { kind: "gt", column: "lastAccessed", value: "2026-01-01" },
    ]);
    expect(result!.residual).not.toBeNull();
    expect(result!.residual!.kind).toBe("leaf");
  });

  it("does not claim leaf for a non-owned column", async () => {
    const { host } = makeHost();
    const engine = await AugmenterEngine.create(host);
    const result = engine.plan(bind("p.tag == 'page'"), planCtx());
    expect(result).toBeNull();
  });

  it("does not claim leaf with a non-literal value", async () => {
    const { host } = makeHost();
    const engine = await AugmenterEngine.create(host);
    // Cross-column comparison: `p.lastAccessed > p.lastRun`.
    const result = engine.plan(bind("p.lastAccessed > p.lastRun"), planCtx());
    expect(result).toBeNull();
  });

  it("does not claim OR composites", async () => {
    const { host } = makeHost();
    const engine = await AugmenterEngine.create(host);
    const result = engine.plan(
      bind("p.lastAccessed > '2026-01-01' or p.lastAccessed < '2025-01-01'"),
      planCtx(),
    );
    expect(result).toBeNull();
  });
});

// execute() -- normal path (no universe expansion)

describe("AugmenterEngine.execute (no universe)", () => {
  it("dispatches predicates and resolves cache keys to object ids", async () => {
    const { host, state } = makeHost();
    state.matchResult = {
      cacheKeys: new Set(["page-a", "page-c"]),
      needsUniverse: false,
    };
    const engine = await AugmenterEngine.create(host);
    const plan = engine.plan(bind("p.lastAccessed > '2026-01-01'"), planCtx());
    expect(plan).not.toBeNull();
    const { instr, stats, operations } = makeInstr();
    const rs = await engine.execute(plan!, instr);
    expect(rs.kind).toBe("ids");
    if (rs.kind !== "ids") throw new Error("unreachable");
    expect([...rs.ids].sort((a, b) => a - b)).toEqual([1, 3]);
    expect(rs.relation).toBe("p");
    expect(state.dispatches).toHaveLength(1);
    expect(state.dispatches[0]).toEqual([
      { kind: "gt", column: "lastAccessed", value: "2026-01-01" },
    ]);
    expect(state.universeCalls).toBe(0);
    expect(stats["rows-returned"]).toBe(2);
    expect(stats["rows-examined"]).toBe(4);
    expect(operations).toContain("augmenter-match");
    expect(operations).toContain("augmenter-lookup-ids");
    expect(operations).not.toContain("augmenter-universe-scan");
  });
});

// execute() -- universe expansion (purely is-nil conjunction)

describe("AugmenterEngine.execute (universe expansion)", () => {
  it("unions cache matches with ids absent from the cache for is-nil", async () => {
    const { host, state } = makeHost();
    state.matchResult = {
      cacheKeys: new Set(),
      needsUniverse: true,
    };
    const engine = await AugmenterEngine.create(host);
    const plan = engine.plan(bind("p.lastAccessed == nil"), planCtx());
    expect(plan).not.toBeNull();
    const { instr, operations } = makeInstr();
    const rs = await engine.execute(plan!, instr);
    if (rs.kind !== "ids") throw new Error("unreachable");
    expect([...rs.ids].sort((a, b) => a - b)).toEqual([4, 5]);
    expect(state.universeCalls).toBe(1);
    expect(operations).toContain("augmenter-universe-scan");
  });

  it("includes both in-cache matches AND absent ids when both contribute", async () => {
    const { host, state } = makeHost();
    state.matchResult = {
      cacheKeys: new Set(["page-b"]), // matched -> id 2
      needsUniverse: true,
    };
    const engine = await AugmenterEngine.create(host);
    const plan = engine.plan(bind("p.lastAccessed == nil"), planCtx());
    expect(plan).not.toBeNull();
    const { instr } = makeInstr();
    const rs = await engine.execute(plan!, instr);
    if (rs.kind !== "ids") throw new Error("unreachable");
    expect([...rs.ids].sort((a, b) => a - b)).toEqual([2, 4, 5]);
  });
});

// getColumnStats()

describe("AugmenterEngine.getColumnStats", () => {
  it("returns rowCount + ndv for owned columns", async () => {
    const { host } = makeHost();
    const engine = await AugmenterEngine.create(host);
    expect(engine.getColumnStats("lastAccessed")).toEqual({
      rowCount: 3,
      ndv: 3,
    });
    expect(engine.getColumnStats("lastRun")).toEqual({
      rowCount: 1,
      ndv: 1,
    });
  });

  it("returns undefined for unknown columns", async () => {
    const { host } = makeHost();
    const engine = await AugmenterEngine.create(host);
    expect(engine.getColumnStats("tag")).toBeUndefined();
  });
});
