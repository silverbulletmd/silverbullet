import { expect, test } from "vitest";
import type { ScriptRecord } from "../../space_lua.ts";
import { filterScripts, formatLoadTime, scriptCounts } from "./scripts.ts";

// Loose on purpose: each case sets only the fields its status has
const record = (over: Record<string, unknown>): ScriptRecord =>
  ({
    ref: "Sample@0",
    source: "x = 1",
    priority: 0,
    status: "loaded",
    ms: 2,
    ...over,
  }) as ScriptRecord;

const scripts = [
  record({ ref: "Library/Std/Config@0", priority: 100 }),
  record({ ref: "Scratch/Helpers@0", status: "failed", error: "boom" }),
  record({ ref: "Scratch/Helpers@212" }),
  record({ ref: "Scratch/Slow@0", status: "stopped", ms: 5000 }),
  record({ ref: "Scratch/Loop@0", status: "quarantined", ms: 0 }),
];

const refs = (rs: ScriptRecord[]) => rs.map((r) => r.ref);

test("filters keep load order; quarantined covers stopped scripts", () => {
  expect(refs(filterScripts(scripts, "", "all"))).toEqual(refs(scripts));
  expect(refs(filterScripts(scripts, "", "failed"))).toEqual([
    "Scratch/Helpers@0",
  ]);
  expect(refs(filterScripts(scripts, "", "quarantined"))).toEqual([
    "Scratch/Slow@0",
    "Scratch/Loop@0",
  ]);
  expect(refs(filterScripts(scripts, "HELPERS", "loaded"))).toEqual([
    "Scratch/Helpers@212",
  ]);
});

test("counts per filter", () => {
  expect(scriptCounts(scripts)).toEqual({
    all: 5,
    loaded: 2,
    failed: 1,
    quarantined: 2,
  });
});

test("load times round, and a skipped script has none", () => {
  expect(formatLoadTime(record({ ms: 0.4 }))).toBe("<1 ms");
  expect(formatLoadTime(record({ ms: 11.6 }))).toBe("12 ms");
  expect(formatLoadTime(record({ status: "quarantined" }))).toBe("–");
});
