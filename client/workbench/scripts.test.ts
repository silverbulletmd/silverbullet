import { expect, test, vi } from "vitest";
import type { ScriptRecord } from "../space_lua.ts";
import {
  filterScripts,
  formatLoadTime,
  originCounts,
  scriptActions,
  scriptCounts,
  scriptLabels,
  scriptsFrom,
} from "./scripts.ts";

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

test("labels show the offset only for pages with several scripts", () => {
  const labels = scriptLabels(scripts);
  expect(labels.get("Library/Std/Config@0")).toEqual({
    page: "Library/Std/Config",
  });
  expect(labels.get("Scratch/Helpers@212")).toEqual({
    page: "Scratch/Helpers",
    pos: 212,
  });
});

test("load times round, and a skipped script has none", () => {
  expect(formatLoadTime(record({ ms: 0.4 }))).toBe("<1 ms");
  expect(formatLoadTime(record({ ms: 11.6 }))).toBe("12 ms");
  expect(formatLoadTime(record({ status: "quarantined" }))).toBe("–");
});

test("only quarantined or stopped scripts offer re-enabling", async () => {
  const labels = (r: ScriptRecord) => scriptActions(r).map((a) => a.label);
  expect(labels(scripts[0])).toEqual(["Open source", "Copy code"]);
  expect(labels(scripts[3])).toEqual([
    "Open source",
    "Copy code",
    "Re-enable and reload",
  ]);
  const deps = {
    openSource: vi.fn(async () => {}),
    copyText: vi.fn(async () => {}),
    reEnable: vi.fn(async () => {}),
  };
  for (const a of scriptActions(scripts[4])) await a.run(deps);
  expect(deps.openSource).toHaveBeenCalledWith("Scratch/Loop@0");
  expect(deps.copyText).toHaveBeenCalledWith("x = 1");
  expect(deps.reEnable).toHaveBeenCalledWith("Scratch/Loop@0");
});

test("built-in scripts are the ones on Library/Std pages", () => {
  expect(refs(scriptsFrom(scripts, "builtin"))).toEqual([
    "Library/Std/Config@0",
  ]);
  expect(refs(scriptsFrom(scripts, "custom"))).toEqual([
    "Scratch/Helpers@0",
    "Scratch/Helpers@212",
    "Scratch/Slow@0",
    "Scratch/Loop@0",
  ]);
  expect(scriptsFrom(scripts, "all")).toBe(scripts);
  expect(originCounts(scripts)).toEqual({ all: 5, custom: 4, builtin: 1 });
});
