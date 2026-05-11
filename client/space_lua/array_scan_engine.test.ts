import { describe, expect, it } from "vitest";
import {
  ArrayScanEngine,
  ARRAY_SCAN_ENGINE_CAPABILITY,
  ARRAY_SCAN_ENGINE_ID,
} from "./array_scan_engine.ts";
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

describe("ArrayScanEngine", () => {
  it("exported capability advertises a pure scan engine", () => {
    expect(ARRAY_SCAN_ENGINE_CAPABILITY.id).toBe(ARRAY_SCAN_ENGINE_ID);
    expect(ARRAY_SCAN_ENGINE_CAPABILITY.kind).toBe("scan");
    expect(ARRAY_SCAN_ENGINE_CAPABILITY.priority).toBe(10);
    expect(ARRAY_SCAN_ENGINE_CAPABILITY.capabilities).toContain(
      "scan-materialized",
    );
    // Scan engine must NOT advertise predicate capabilities.
    expect(ARRAY_SCAN_ENGINE_CAPABILITY.capabilities).not.toContain(
      "pred-eq" as any,
    );
  });

  it("spec() reflects the configured relation and no composites", () => {
    const e = ArrayScanEngine.create([], "items");
    const s = e.spec();
    expect(s.id).toBe(ARRAY_SCAN_ENGINE_ID);
    expect(s.kind).toBe("scan");
    expect(s.relation).toBe("items");
    expect(s.composites).toEqual([]);
    expect(s.priority).toBe(10);
  });

  it("plan() always returns null (scan does not pushdown)", () => {
    const e = ArrayScanEngine.create([{ x: 1 }]);
    const pred = bindPredicate(parseExpressionString("p.x == 1"), "p")!;
    const plan = e.plan(pred, {
      phase: "source-leaf",
      smallSetThreshold: 100,
      peerEngines: [],
    });
    expect(plan).toBeNull();
  });

  it("execute() emits all rows verbatim when invoked directly", async () => {
    const rows = [{ x: 1 }, { x: 2 }];
    const e = ArrayScanEngine.create(rows);
    const out = await e.execute(
      {
        claimed: {
          kind: "opaque",
          relation: "<scan>",
          expr: { type: "Nil" } as any,
        },
        residual: null,
        estimatedCost: 1,
        estimatedRows: rows.length,
        handle: { rows },
      },
      noopInstr(),
    );
    expect(out.kind).toBe("rows");
    if (out.kind !== "rows") throw new Error("unreachable");
    expect(out.rows).toEqual(rows);
  });
});
