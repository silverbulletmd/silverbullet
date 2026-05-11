/**
 * Grand timing-torture test for `explain analyze verbose hints`.
 *
 * Strategy:
 *
 * - Build a Lua sandbox with helpers that sleep a known amount of
 *   wall-clock time:
 *
 *   - `slow_source(ms, items)`: one-shot sleep on materialize.
 *
 *   - `sleep_then(ms, value)`:  sleeps then returns the value.
 *
 *     Note: Used per-row in `where`, `group by`, `having`, `select` and
 *     `order by` predicates.
 *
 * - Run a series of complex queries that stress every
 *   stage in the pipeline.
 *
 * - Capture the rendered `explain analyze verbose hints` output, dump
 *   it to stdout for human inspection, and assert:
 *
 *     1. Every plan node carries an `actual time=START..TOTAL` block.
 *
 *     2. `parent.total >= child.total` at every direct parent-child edge.
 *
 *        Note: this is the Postgres-like cumulative time invariant.
 *
 *     3. The total time at the plan root is at least the sum of
 *        injected sleeps that the executor must traverse on the
 *        critical path (sanity check).
 *
 * Note: The injected sleeps (50+ ms per stage) are far above the OS
 * scheduler resolution, so the timing differences are meaningful and
 * stable across runs.
 */

import { beforeEach, describe, expect, test } from "vitest";
import { parse } from "./parse.ts";
import { evalStatement } from "./eval.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";
import {
  LuaBuiltinFunction,
  LuaEnv,
  LuaRuntimeError,
  LuaStackFrame,
  LuaTable,
} from "./runtime.ts";

// 5 ms per row and ~10 rows per stage we get ~50 ms per stage
const PER_ROW_SLEEP_MS = 5;
const SOURCE_SLEEP_MS = 50;

// Tolerance to absorb scheduler jitter when comparing per-node
// elapsed times. Bigger than typical jitter (~1-2 ms) but well below
// our injected sleeps (50+ ms) so it doesn't mask real regressions.
const TIMING_TOLERANCE_MS = 5;

// Helpers exposed to Lua

/**
 * Sleeps for `ms` milliseconds, then returns whatever was passed in
 * `value`. Used to inject latency into expression evaluation.
 */
function makeSleepThen(): LuaBuiltinFunction {
  return new LuaBuiltinFunction(async (_sf, ms: any, value: any) => {
    const n = typeof ms === "bigint" ? Number(ms) : (ms as number);
    await new Promise((resolve) => setTimeout(resolve, n));
    return value;
  });
}

/**
 * One-shot source latency: sleeps `ms` once, then returns the table.
 * Used as `from t = slow_source(50, ts)` to make the scan stage take
 * a known minimum amount of wall-clock time.
 */
function makeSlowSource(): LuaBuiltinFunction {
  return new LuaBuiltinFunction(async (_sf, ms: any, items: any) => {
    const n = typeof ms === "bigint" ? Number(ms) : (ms as number);
    await new Promise((resolve) => setTimeout(resolve, n));
    return items;
  });
}

// Plan parsing + assertions

interface PlanNode {
  // Full rendered text of the line carrying `actual time=...`.
  line: string;
  // Indentation depth (counts leading spaces; renderer uses 2-space steps).
  depth: number;
  // Node label parsed from the line ("Sort", "Hash Join", etc.).
  label: string;
  // Time of first row, in ms (per-node elapsed).
  startup: number;
  // Time of last row, in ms (per-node elapsed).
  total: number;
}

/**
 * Walk the rendered plan text and pull out (depth, label, startup, total)
 * for every line that carries an `actual time=...` block. Indent depth
 * uses leading whitespace (the renderer indents children by 2 spaces
 * with a `->` marker between siblings; we just count leading spaces and
 * normalise the `->` adjustment).
 */
function parsePlanNodes(planText: string): PlanNode[] {
  const out: PlanNode[] = [];
  for (const rawLine of planText.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const m = line.match(/actual time=([\d.]+)\.\.([\d.]+)/);
    if (!m) continue;
    // Capture the indentation prefix; the renderer adds two extra
    // spaces for the `->` arrow before the label.
    const prefix = line.match(/^( *)/)![1];
    let depth = prefix.length;
    if (/->\s/.test(line)) depth += 2;
    // Pull out the label (Scan / Sort / Hash Join / etc.)
    const labelMatch = line.match(/^\s*(?:->\s+)?([^()]+?)\s+\(cost=/);
    const label = labelMatch ? labelMatch[1].trim() : "<unknown>";
    out.push({
      line,
      depth,
      label,
      startup: Number(m[1]),
      total: Number(m[2]),
    });
  }
  return out;
}

function assertEveryNodeHasTiming(plan: string, queryName: string) {
  const lines = plan.split("\n");
  const offenders: string[] = [];
  for (const line of lines) {
    // We look for any structural plan line. Structural lines either
    // start the plan (top node) or carry the `->` child marker. We
    // identify them by the presence of a `(cost=...)` block, which
    // every node carries even when costs are off in non-cost mode.
    if (!/\(cost=[\d.]+\.\.[\d.]+/.test(line)) continue;
    if (/actual time=/.test(line)) continue;
    if (/never executed/.test(line)) continue; // legitimately skipped
    offenders.push(line.trim());
  }
  if (offenders.length > 0) {
    throw new Error(
      `[${queryName}] ${offenders.length} plan node(s) missing ` +
        `\`actual time=...\`:\n  ${offenders.join("\n  ")}\n\n` +
        `Full plan:\n${plan}`,
    );
  }
}

/**
 * Verify Postgres-style monotonicity: for every parent/child edge in
 * the rendered tree, `parent.total >= child.total`. We walk the parsed
 * node list in order; whenever a node's depth is strictly greater than
 * its predecessor's we treat the predecessor as the parent and check
 * the relation.
 */
function assertParentTotalGEChildTotal(nodes: PlanNode[], queryName: string) {
  // Maintain a stack of (depth, total) for currently-open ancestors.
  // When we encounter a node at depth D, any ancestor at depth >= D is
  // popped (it's a sibling/cousin, not an ancestor). The remaining top
  // of stack is this node's parent.
  const stack: PlanNode[] = [];
  const failures: string[] = [];

  for (const node of nodes) {
    while (stack.length > 0 && stack[stack.length - 1].depth >= node.depth) {
      stack.pop();
    }
    if (stack.length > 0) {
      const parent = stack[stack.length - 1];
      if (parent.total + TIMING_TOLERANCE_MS < node.total) {
        failures.push(
          `parent ${parent.label} total=${parent.total} < ` +
            `child ${node.label} total=${node.total}\n` +
            `  parent: ${parent.line}\n` +
            `  child:  ${node.line}`,
        );
      }
    }
    stack.push(node);
  }

  if (failures.length > 0) {
    throw new Error(
      `[${queryName}] parent.total >= child.total invariant violated ` +
        `at ${failures.length} edge(s):\n  ${failures.join("\n  ")}`,
    );
  }
}

/**
 * Sanity check: the topmost node's total must be at least `expectedFloorMs`
 * minus the tolerance.
 */
function assertRootTimeAtLeast(
  nodes: PlanNode[],
  expectedFloorMs: number,
  queryName: string,
) {
  if (nodes.length === 0) {
    throw new Error(`[${queryName}] no timed nodes parsed from plan`);
  }
  const root = nodes[0];
  if (root.total + TIMING_TOLERANCE_MS < expectedFloorMs) {
    throw new Error(
      `[${queryName}] root ${root.label} total=${root.total} ms is ` +
        `below the injected-sleep floor ${expectedFloorMs} ms; ` +
        `something is bypassing the sleeps.\n` +
        `Root line: ${root.line}`,
    );
  }
}

// Lua

interface RunResult {
  plan: string;
  rawOutput: string[];
}

async function runLua(
  luaSource: string,
  setup: (env: LuaEnv) => void,
): Promise<RunResult> {
  // Mimic the singleton `globalThis.client.config` shim.
  if (!(globalThis as any).client) {
    (globalThis as any).client = {
      config: {
        get(_key: string, fallback: unknown) {
          return fallback ?? {};
        },
      },
    };
  }

  const captured: string[] = [];
  const env = new LuaEnv(luaBuildStandardEnv());
  env.set("sleep_then", makeSleepThen());
  env.set("slow_source", makeSlowSource());
  env.set(
    "_capture",
    new LuaBuiltinFunction((_sf, value: any) => {
      captured.push(String(value));
    }),
  );
  setup(env);

  const chunk = parse(luaSource, {});
  const sf = LuaStackFrame.createWithGlobalEnv(env, chunk.ctx);
  try {
    await evalStatement(chunk, env, sf);
  } catch (e: any) {
    if (e instanceof LuaRuntimeError) {
      throw new Error(
        `Lua runtime error:\n${e.toPrettyString(luaSource)}\n\nLua source:\n${luaSource}`,
      );
    }
    throw e;
  }

  if (captured.length === 0) {
    throw new Error(
      `Lua script did not capture any plans. Source:\n${luaSource}`,
    );
  }
  return { plan: captured[0], rawOutput: captured };
}

function buildSourceLuaTable(rows: Array<Record<string, unknown>>): LuaTable {
  // Sources are 1-indexed Lua arrays of records. We use the LuaTable
  // constructor's array-init form for both the per-row records and
  // the outer array.
  return new LuaTable(rows.map((row) => new LuaTable(row)));
}

function dumpPlan(name: string, plan: string) {
  // Send each plan to STDOUT under the test (intentionally noisy for
  // human review, if needed)
  console.log(
    `\n===== BEGIN ${name} =====\n${plan}\n===== END ${name} =====\n`,
  );
}

// --------------------------------------------------------------------
// Test fixtures

// 10-row "tags" table: 4 distinct tags so groupBy reduces to 4 groups
// and a `having count() > 1` filters the small ones away. Each tag has
// a numeric `value` so sum/avg aggregates make sense.
const TAGS_ROWS = [
  { tag: "x", page: "p1", value: 10 },
  { tag: "x", page: "p1", value: 20 },
  { tag: "x", page: "p2", value: 30 },
  { tag: "y", page: "p2", value: 40 },
  { tag: "y", page: "p3", value: 50 },
  { tag: "z", page: "p3", value: 60 },
  { tag: "z", page: "p4", value: 70 },
  { tag: "z", page: "p4", value: 80 },
  { tag: "z", page: "p5", value: 90 },
  { tag: "w", page: "p5", value: 100 },
];

// 5-row "pages" table that joins to TAGS via `name == page`.
const PAGES_ROWS = [
  { name: "p1", body: "alpha" },
  { name: "p2", body: "beta" },
  { name: "p3", body: "gamma" },
  { name: "p4", body: "delta" },
  { name: "p5", body: "epsilon" },
];

// --------------------------------------------------------------------
// Tests

describe("explain analyze verbose hints -- timing torture", () => {
  let setupEnv: (env: LuaEnv) => void;

  beforeEach(() => {
    setupEnv = (env: LuaEnv) => {
      env.set("ts", buildSourceLuaTable(TAGS_ROWS));
      env.set("ps", buildSourceLuaTable(PAGES_ROWS));
    };
  });

  test("Q1: single source -- where -> group by -> having -> select -> order by -> limit", async () => {
    const lua = `
      _capture(tostring(query[[
        explain analyze verbose hints
        from t = slow_source(${SOURCE_SLEEP_MS}, ts)
        where sleep_then(${PER_ROW_SLEEP_MS}, t.value > 0)
        group by sleep_then(${PER_ROW_SLEEP_MS}, t.tag)
        having count() > 0 and sleep_then(${PER_ROW_SLEEP_MS * 2}, true)
        select { tag = sleep_then(${PER_ROW_SLEEP_MS * 2}, t.tag), n = count() }
        order by sleep_then(${PER_ROW_SLEEP_MS}, t.tag)
        limit 10
      ]]))
    `;
    const { plan } = await runLua(lua, setupEnv);
    dumpPlan("Q1: single-source full pipeline", plan);

    assertEveryNodeHasTiming(plan, "Q1");
    const nodes = parsePlanNodes(plan);
    assertParentTotalGEChildTotal(nodes, "Q1");
    // The scan alone is 50 ms, plus ~50 ms each for where/groupBy/etc.
    // We bound the floor very conservatively so the test isn't flaky.
    assertRootTimeAtLeast(nodes, SOURCE_SLEEP_MS, "Q1");
  });

  test("Q2: multi-source join -- where + select * + order by + limit", async () => {
    const lua = `
      _capture(tostring(query[[
        explain analyze verbose hints
        from
          t = slow_source(${SOURCE_SLEEP_MS}, ts),
          p = slow_source(${SOURCE_SLEEP_MS}, ps)
        where sleep_then(${PER_ROW_SLEEP_MS}, t.page == p.name)
        select *
        order by sleep_then(${PER_ROW_SLEEP_MS}, p.name)
        limit 5
      ]]))
    `;
    const { plan } = await runLua(lua, setupEnv);
    dumpPlan("Q2: multi-source join + select * + order by", plan);

    assertEveryNodeHasTiming(plan, "Q2");
    const nodes = parsePlanNodes(plan);
    assertParentTotalGEChildTotal(nodes, "Q2");
    // Both scans run sequentially: 50 + 50 = 100 ms minimum on the
    // critical path before any wrapper kicks in.
    assertRootTimeAtLeast(nodes, SOURCE_SLEEP_MS * 2, "Q2");
  });

  test("Q3: multi-source join + group by + having + aggregates + order by", async () => {
    const lua = `
      _capture(tostring(query[[
        explain analyze verbose hints
        from
          t = slow_source(${SOURCE_SLEEP_MS}, ts),
          p = slow_source(${SOURCE_SLEEP_MS}, ps)
        where sleep_then(${PER_ROW_SLEEP_MS}, t.page == p.name)
        group by sleep_then(${PER_ROW_SLEEP_MS}, t.tag)
        having count() >= 1 and sleep_then(${PER_ROW_SLEEP_MS * 2}, true)
        select {
          tag = sleep_then(${PER_ROW_SLEEP_MS * 2}, t.tag),
          n = count(),
          total = sum(t.value),
        }
        order by sleep_then(${PER_ROW_SLEEP_MS}, t.tag) desc
        limit 10
      ]]))
    `;
    const { plan } = await runLua(lua, setupEnv);
    dumpPlan("Q3: multi-source join + group by + having + aggregates", plan);

    assertEveryNodeHasTiming(plan, "Q3");
    const nodes = parsePlanNodes(plan);
    assertParentTotalGEChildTotal(nodes, "Q3");
    assertRootTimeAtLeast(nodes, SOURCE_SLEEP_MS * 2, "Q3");
  });

  test("Q4: implicit aggregate (no group by) + select aggregates", async () => {
    const lua = `
      _capture(tostring(query[[
        explain analyze verbose hints
        from t = slow_source(${SOURCE_SLEEP_MS}, ts)
        where sleep_then(${PER_ROW_SLEEP_MS}, t.value > 0)
        select {
          n = count(),
          s = sum(t.value),
          avg = avg(t.value),
        }
      ]]))
    `;
    const { plan } = await runLua(lua, setupEnv);
    dumpPlan("Q4: implicit aggregate (no group by)", plan);

    assertEveryNodeHasTiming(plan, "Q4");
    const nodes = parsePlanNodes(plan);
    assertParentTotalGEChildTotal(nodes, "Q4");
    assertRootTimeAtLeast(nodes, SOURCE_SLEEP_MS, "Q4");
  });

  test("Q5: implicit Project (no explicit select) + group by + having", async () => {
    const lua = `
      _capture(tostring(query[[
        explain analyze verbose hints
        from t = slow_source(${SOURCE_SLEEP_MS}, ts)
        group by sleep_then(${PER_ROW_SLEEP_MS}, t.tag)
        having count() > 0 and sleep_then(${PER_ROW_SLEEP_MS * 2}, true)
        order by sleep_then(${PER_ROW_SLEEP_MS}, t.tag) desc
      ]]))
    `;
    const { plan } = await runLua(lua, setupEnv);
    dumpPlan("Q5: implicit Project + group by + having", plan);

    assertEveryNodeHasTiming(plan, "Q5");
    const nodes = parsePlanNodes(plan);
    assertParentTotalGEChildTotal(nodes, "Q5");
    assertRootTimeAtLeast(nodes, SOURCE_SLEEP_MS, "Q5");
  });

  test("Q6: multi-source join + non-grouped (Project above Sort)", async () => {
    const lua = `
      _capture(tostring(query[[
        explain analyze verbose hints
        from
          t = slow_source(${SOURCE_SLEEP_MS}, ts),
          p = slow_source(${SOURCE_SLEEP_MS}, ps)
        where sleep_then(${PER_ROW_SLEEP_MS}, t.page == p.name)
        select { tag = t.tag, name = sleep_then(${PER_ROW_SLEEP_MS * 2}, p.name) }
        order by sleep_then(${PER_ROW_SLEEP_MS}, p.name)
        limit 3
      ]]))
    `;
    const { plan } = await runLua(lua, setupEnv);
    dumpPlan("Q6: multi-source non-grouped (Project above Sort)", plan);

    assertEveryNodeHasTiming(plan, "Q6");
    const nodes = parsePlanNodes(plan);
    assertParentTotalGEChildTotal(nodes, "Q6");

    // Project must appear above Sort for non-grouped queries
    const projectIdx = nodes.findIndex((n) => n.label === "Project");
    const sortIdx = nodes.findIndex((n) => n.label === "Sort");
    expect(projectIdx).toBeGreaterThanOrEqual(0);
    expect(sortIdx).toBeGreaterThanOrEqual(0);
    expect(projectIdx).toBeLessThan(sortIdx);
    // And the depth ordering must match: Sort sits one level deeper.
    expect(nodes[sortIdx].depth).toBeGreaterThan(nodes[projectIdx].depth);

    assertRootTimeAtLeast(nodes, SOURCE_SLEEP_MS * 2, "Q6");
  });
});
