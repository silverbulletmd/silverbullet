import { describe, expect, it } from "vitest";
import {
  ComputeFallbackEngine,
  COMPUTE_FALLBACK_ENGINE_CAPABILITY,
  COMPUTE_FALLBACK_ENGINE_ID,
  COMPUTE_FALLBACK_RELATION,
} from "./compute_fallback_engine.ts";
import { bindPredicate } from "./bind_predicate.ts";
import { parseExpressionString } from "./parse.ts";
import type { EngineInstrumentation } from "./engine_contract.ts";

function noopInstr(): EngineInstrumentation {
  return {
    recordStat: () => {},
    beginOperation: () => () => {},
    recordEvent: () => {},
  };
}

describe("ComputeFallbackEngine", () => {
  it("exported capability advertises the unified pred-* vocabulary", () => {
    expect(COMPUTE_FALLBACK_ENGINE_CAPABILITY.id).toBe(
      COMPUTE_FALLBACK_ENGINE_ID,
    );
    expect(COMPUTE_FALLBACK_ENGINE_CAPABILITY.kind).toBe("compute");
    expect(COMPUTE_FALLBACK_ENGINE_CAPABILITY.priority).toBe(5);
    expect(COMPUTE_FALLBACK_ENGINE_CAPABILITY.capabilities).toContain(
      "pred-eq",
    );
    expect(COMPUTE_FALLBACK_ENGINE_CAPABILITY.capabilities).toContain(
      "pred-in",
    );
    expect(COMPUTE_FALLBACK_ENGINE_CAPABILITY.capabilities).toContain(
      "pred-is-nil",
    );
    expect(COMPUTE_FALLBACK_ENGINE_CAPABILITY.capabilities).toContain(
      "bool-or",
    );
    expect(COMPUTE_FALLBACK_ENGINE_CAPABILITY.capabilities).toContain(
      "scan-materialized",
    );
    // Legacy `aug-*` namespace must not leak in.
    expect(COMPUTE_FALLBACK_ENGINE_CAPABILITY.capabilities).not.toContain(
      "aug-eq" as any,
    );
  });

  it("spec() returns a relation-agnostic, low-priority engine", () => {
    const e = ComputeFallbackEngine.create();
    const s = e.spec();
    expect(s.id).toBe(COMPUTE_FALLBACK_ENGINE_ID);
    expect(s.kind).toBe("compute");
    expect(s.relation).toBe(COMPUTE_FALLBACK_RELATION);
    expect(s.priority).toBe(5);
    expect(s.baseCostWeight).toBe(1.0);
    expect(s.composites).toEqual(["and", "or", "not"]);
    expect(s.runtimeStatsKinds).toContain("rows-examined");
    expect(s.runtimeStatsKinds).toContain("rows-returned");
  });

  it("plan() universally claims any predicate (no residual)", () => {
    const e = ComputeFallbackEngine.create([{}]);
    const pred = bindPredicate(parseExpressionString("p.x == 1"), "p")!;
    const plan = e.plan(pred, {
      phase: "source-leaf",
      smallSetThreshold: 100,
      peerEngines: [],
    });
    expect(plan).not.toBeNull();
    expect(plan!.claimed).toBe(pred);
    expect(plan!.residual).toBeNull();
    expect(plan!.estimatedRows).toBe(1);
    expect(plan!.estimatedCost).toBeGreaterThan(0);
  });

  it("execute() invokes the row evaluator and emits matching rows", async () => {
    const rows = [{ x: 1 }, { x: 2 }, { x: 3 }];
    const e = ComputeFallbackEngine.create(rows, async (_pred, row) => {
      return row.x >= 2;
    });
    const pred = bindPredicate(parseExpressionString("p.x >= 2"), "p")!;
    const plan = e.plan(pred, {
      phase: "source-leaf",
      smallSetThreshold: 100,
      peerEngines: [],
    })!;
    const out = await e.execute(plan, noopInstr());
    expect(out.kind).toBe("rows");
    if (out.kind !== "rows") throw new Error("unreachable");
    expect(out.rows).toEqual([{ x: 2 }, { x: 3 }]);
  });

  it("getColumnStats() returns undefined (compute owns no columns)", () => {
    const e = ComputeFallbackEngine.create();
    expect(e.getColumnStats("anything")).toBeUndefined();
  });
});
