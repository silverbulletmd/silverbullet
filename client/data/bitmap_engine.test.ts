import { describe, expect, it } from "vitest";
import {
  BitmapEngine,
  type BitmapEngineHost,
  type BitmapEngineHostSnapshot,
  type BitmapEnginePredicate,
} from "./bitmap_engine.ts";
import { bindPredicate } from "../space_lua/bind_predicate.ts";
import { parseExpressionString } from "../space_lua/parse.ts";
import type { PlanContext } from "../space_lua/engine_contract.ts";
import type {
  BoundPredicate,
  EngineInstrumentation,
} from "../space_lua/engine_contract.ts";

interface RecordedDispatch {
  preds: BitmapEnginePredicate[];
}

interface MockHostState {
  snapshot: BitmapEngineHostSnapshot;
  matchResult: number[] | undefined;
  loadResult: any[];
  dispatches: RecordedDispatch[];
  loadCalls: number[][];
}

function makeHost(
  partial: Partial<BitmapEngineHostSnapshot> = {},
  matchResult: number[] | undefined = [],
  loadResult: any[] = [],
): { host: BitmapEngineHost; state: MockHostState } {
  const snapshot: BitmapEngineHostSnapshot = {
    tagName: "p",
    trusted: true,
    indexComplete: true,
    rowCount: 100,
    averageColumnCount: 10,
    columns: [
      { name: "tag", indexed: true, ndv: 5, mcvSize: 5, alwaysIndexed: true },
      { name: "name", indexed: false, ndv: 100, alwaysIndexed: false },
      { name: "banner", indexed: true, ndv: 3, mcvSize: 3, alwaysIndexed: false },
      { name: "size", indexed: true, ndv: 80, mcvSize: 10, alwaysIndexed: false },
    ],
    ...partial,
  };
  const state: MockHostState = {
    snapshot,
    matchResult,
    loadResult,
    dispatches: [],
    loadCalls: [],
  };
  const host: BitmapEngineHost = {
    snapshot: () => state.snapshot,
    matchPredicates: async (preds) => {
      state.dispatches.push({ preds });
      return state.matchResult;
    },
    loadObjects: async (ids) => {
      state.loadCalls.push(ids);
      return state.loadResult;
    },
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
  if (!bound) {
    throw new Error(`bindPredicate returned undefined for: ${where}`);
  }
  return bound;
}

// spec()

describe("BitmapEngine.spec", () => {
  it("advertises object-index-bitmap-extended when trusted", async () => {
    const { host } = makeHost();
    const engine = await BitmapEngine.create(host);
    const spec = engine.spec();
    expect(spec.id).toBe("object-index-bitmap-extended");
    expect(spec.kind).toBe("index");
    expect(spec.relation).toBe("p");
    expect(spec.priority).toBe(20);
    expect(spec.composites).toEqual(["and"]);
  });

  it("downgrades to object-index-scan when not trusted", async () => {
    const { host } = makeHost({ trusted: false });
    const engine = await BitmapEngine.create(host);
    const spec = engine.spec();
    expect(spec.id).toBe("object-index-scan");
    expect(spec.priority).toBe(10);
    expect(spec.baseCostWeight).toBe(1.0);
  });

  it("includes only indexed columns in the spec", async () => {
    const { host } = makeHost();
    const engine = await BitmapEngine.create(host);
    const cols = engine
      .spec()
      .columns.map((c) => c.name)
      .sort();
    expect(cols).toEqual(["banner", "size", "tag"]);
  });

  it("advertises eq/neq/lt/lte/gt/gte/in per indexed column", async () => {
    const { host } = makeHost();
    const engine = await BitmapEngine.create(host);
    for (const col of engine.spec().columns) {
      expect(col.predicateKinds.sort()).toEqual(
        ["eq", "gt", "gte", "in", "lt", "lte", "neq"].sort(),
      );
      expect(col.valueKinds).toEqual(["literal"]);
    }
  });

  it("clears statsKinds when index is incomplete", async () => {
    const { host } = makeHost({ indexComplete: false });
    const engine = await BitmapEngine.create(host);
    for (const col of engine.spec().columns) {
      expect(col.statsKinds).toEqual([]);
    }
  });
});

// plan()

describe("BitmapEngine.plan", () => {
  it("returns null when the engine is not trusted", async () => {
    const { host } = makeHost({ trusted: false });
    const engine = await BitmapEngine.create(host);
    const result = engine.plan(bind("p.tag == 'page'"), planCtx());
    expect(result).toBeNull();
  });

  it("claims a single eq leaf against an indexed column", async () => {
    const { host } = makeHost();
    const engine = await BitmapEngine.create(host);
    const result = engine.plan(bind("p.tag == 'page'"), planCtx());
    expect(result).not.toBeNull();
    expect(result!.claimed.kind).toBe("leaf");
    expect(result!.residual).toBeNull();
    const handle = result!.handle as { preds: BitmapEnginePredicate[] };
    expect(handle.preds).toEqual([
      { kind: "eq", column: "tag", value: "page" },
    ]);
  });

  it("normalises literal-on-left to column-on-left and flips comparator", async () => {
    const { host } = makeHost();
    const engine = await BitmapEngine.create(host);
    // `5 < p.size` => `p.size > 5` (op flipped)
    const result = engine.plan(bind("5 < p.size"), planCtx());
    expect(result).not.toBeNull();
    const handle = result!.handle as { preds: BitmapEnginePredicate[] };
    expect(handle.preds).toEqual([{ kind: "gt", column: "size", value: 5 }]);
  });

  it("claims AND-of-leaves and leaves the residual untouched", async () => {
    const { host } = makeHost();
    const engine = await BitmapEngine.create(host);
    const result = engine.plan(
      bind("p.tag == 'page' and p.banner == 'x' and p.name == 'home'"),
      planCtx(),
    );
    expect(result).not.toBeNull();
    expect(result!.claimed.kind).toBe("composite");
    const handle = result!.handle as { preds: BitmapEnginePredicate[] };
    expect(handle.preds).toEqual([
      { kind: "eq", column: "tag", value: "page" },
      { kind: "eq", column: "banner", value: "x" },
    ]);
    expect(result!.residual).not.toBeNull();
    expect(result!.residual!.kind).toBe("leaf");
  });

  it("returns null when no leaf is claimable", async () => {
    const { host } = makeHost();
    const engine = await BitmapEngine.create(host);
    const result = engine.plan(bind("p.name == 'home'"), planCtx());
    expect(result).toBeNull();
  });

  it("does not claim a leaf with a non-literal value", async () => {
    const { host } = makeHost();
    const engine = await BitmapEngine.create(host);
    const result = engine.plan(bind("p.tag == p.banner"), planCtx());
    expect(result).toBeNull();
  });

  it("collapses `IN` with one element to `eq`", async () => {
    const { host } = makeHost();
    const engine = await BitmapEngine.create(host);
    const result = engine.plan(bind("p.tag in {'page'}"), planCtx());
    expect(result).not.toBeNull();
    const handle = result!.handle as { preds: BitmapEnginePredicate[] };
    expect(handle.preds).toEqual([
      { kind: "eq", column: "tag", value: "page" },
    ]);
  });

  it("preserves multi-element IN", async () => {
    const { host } = makeHost();
    const engine = await BitmapEngine.create(host);
    const result = engine.plan(bind("p.tag in {'page', 'doc'}"), planCtx());
    expect(result).not.toBeNull();
    const handle = result!.handle as { preds: BitmapEnginePredicate[] };
    expect(handle.preds).toEqual([
      { kind: "in", column: "tag", values: ["page", "doc"] },
    ]);
  });

  it("claims OR-of-same-column-eq via OR-into-IN normalisation", async () => {
    const { host } = makeHost();
    const engine = await BitmapEngine.create(host);
    const result = engine.plan(
      bind("p.tag == 'page' or p.tag == 'doc'"),
      planCtx(),
    );
    expect(result).not.toBeNull();
    const handle = result!.handle as { preds: BitmapEnginePredicate[] };
    expect(handle.preds).toEqual([
      { kind: "in", column: "tag", values: ["page", "doc"] },
    ]);
  });

  it("does not claim mixed-column OR composites", async () => {
    const { host } = makeHost();
    const engine = await BitmapEngine.create(host);
    // Different columns -> OR-into-IN does not apply -> composite
    // stays as-is -> bitmap engine refuses (claims AND-only).
    const result = engine.plan(
      bind("p.tag == 'page' or p.banner == 'x'"),
      planCtx(),
    );
    expect(result).toBeNull();
  });
});

// execute()

describe("BitmapEngine.execute", () => {
  it("dispatches the claimed predicates to the host and returns ids", async () => {
    const { host, state } = makeHost({}, [1, 5, 9]);
    const engine = await BitmapEngine.create(host);
    const plan = engine.plan(bind("p.tag == 'page'"), planCtx());
    expect(plan).not.toBeNull();
    const { instr, stats, operations } = makeInstr();
    const rs = await engine.execute(plan!, instr);
    expect(rs.kind).toBe("ids");
    if (rs.kind !== "ids") throw new Error("unreachable");
    expect([...rs.ids].sort((a, b) => a - b)).toEqual([1, 5, 9]);
    expect(rs.relation).toBe("p");
    expect(state.dispatches).toHaveLength(1);
    expect(state.dispatches[0].preds).toEqual([
      { kind: "eq", column: "tag", value: "page" },
    ]);
    expect(stats["rows-returned"]).toBe(3);
    expect(stats["rows-examined"]).toBe(100);
    expect(operations).toContain("bitmap-match");
  });

  it("returns kind:'declined' and records an event when host declines", async () => {
    const { host, state } = makeHost();
    // Host declines the dispatch (mirrors the legacy bitmap returning
    // `undefined` for an untrusted column at execute time).
    state.matchResult = undefined;
    const engine = await BitmapEngine.create(host);
    const plan = engine.plan(bind("p.tag == 'page'"), planCtx());
    expect(plan).not.toBeNull();
    const { instr, events } = makeInstr();
    const rs = await engine.execute(plan!, instr);
    expect(rs.kind).toBe("declined");
    if (rs.kind !== "declined") throw new Error("unreachable");
    expect(rs.reason).toBe("match-predicates-returned-undefined");
    expect(events.find((e) => e.label === "bitmap-declined")).toBeDefined();
  });
});

// getColumnStats()

describe("BitmapEngine.getColumnStats", () => {
  it("returns rowCount + ndv for known columns when index is complete", async () => {
    const { host } = makeHost();
    const engine = await BitmapEngine.create(host);
    expect(engine.getColumnStats("tag")).toEqual({
      rowCount: 100,
      ndv: 5,
    });
  });

  it("omits ndv when index is still building", async () => {
    const { host } = makeHost({ indexComplete: false });
    const engine = await BitmapEngine.create(host);
    expect(engine.getColumnStats("tag")).toEqual({ rowCount: 100 });
  });

  it("returns undefined for unknown columns", async () => {
    const { host } = makeHost();
    const engine = await BitmapEngine.create(host);
    expect(engine.getColumnStats("does-not-exist")).toBeUndefined();
  });
});

// resolveIds()

describe("BitmapEngine.resolveIds", () => {
  it("hands off to host.loadObjects and records rows-returned", async () => {
    const rows = [{ name: "a" }, { name: "b" }];
    const { host, state } = makeHost({}, [], rows);
    const engine = await BitmapEngine.create(host);
    const { instr, stats, operations } = makeInstr();
    const out = await engine.resolveIds([3, 7], instr);
    expect(out).toBe(rows);
    expect(state.loadCalls).toEqual([[3, 7]]);
    expect(stats["rows-returned"]).toBe(2);
    expect(operations).toContain("bitmap-resolve-ids");
  });
});
