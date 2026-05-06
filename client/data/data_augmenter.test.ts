import { expect, test } from "vitest";
import { Augmenter } from "./data_augmenter.ts";
import { DataStore } from "./datastore.ts";
import { MemoryKvPrimitives } from "./memory_kv_primitives.ts";

test("knownColumns includes declared columns even when cache is empty", async () => {
  const ds = new DataStore(new MemoryKvPrimitives());
  const a = new Augmenter(ds, ["aug"], ["lastAccessed"]);
  await a.load();
  expect(a.knownColumns()).toEqual(["lastAccessed"]);
  expect(a.size()).toBe(0);
  expect(a.rowCountForColumn("lastAccessed")).toBe(0);
  expect(a.ndvForColumn("lastAccessed")).toBe(0);
});

test("knownColumns merges declared and observed columns", async () => {
  const ds = new DataStore(new MemoryKvPrimitives());
  const a = new Augmenter(ds, ["aug"], ["lastAccessed"]);
  await a.setAugmentation("k1", { lastAccessed: "2026-04-29", pinned: true });
  await a.load();
  expect(a.knownColumns()).toEqual(["lastAccessed", "pinned"]);
});

test("Test data augmentation", async () => {
  const ds = new DataStore(new MemoryKvPrimitives());
  const john: any = {
    ref: "john",
    name: "John",
    age: 1234,
  };
  const mary: any = {
    ref: "mary",
    name: "Mary",
    age: 5678,
  };
  await ds.batchSet([
    {
      key: ["john"],
      value: john,
    },
    {
      key: ["mary"],
      value: mary,
    },
  ]);
  const augm = new Augmenter(ds, ["aug"]);
  // Augment only john
  await augm.setAugmentation("john", { augmented: true });
  // Fetch them back
  const objs = [john, mary];
  await augm.augmentObjectArray(objs, "ref");
  expect(objs[0].augmented).toEqual(true);
  expect(objs[1].augmented).toEqual(undefined);
});

async function seededAugmenter(): Promise<Augmenter> {
  const ds = new DataStore(new MemoryKvPrimitives());
  const a = new Augmenter(ds, ["aug"]);
  await a.setAugmentation("Alpha", { lastAccessed: "2026-04-29T07:00:00.000" });
  await a.setAugmentation("Beta", { lastAccessed: "2026-04-29T08:00:00.000" });
  await a.setAugmentation("Charlie", {
    lastAccessed: "2026-04-29T09:00:00.000",
    pinned: true,
  });
  await a.setAugmentation("Delta", { pinned: false });
  await a.load();
  return a;
}

test("matchMultiplePredicates: undefined for empty input", async () => {
  const a = await seededAugmenter();
  expect(a.matchMultiplePredicates([])).toBeUndefined();
});

test("matchMultiplePredicates: eq value matches only present cache entries", async () => {
  const a = await seededAugmenter();
  const r = a.matchMultiplePredicates([
    { kind: "eq", column: "lastAccessed", value: "2026-04-29T08:00:00.000" },
  ])!;
  expect([...r.cacheKeys].sort()).toEqual(["Beta"]);
  expect(r.needsUniverse).toBe(false);
});

test("matchMultiplePredicates: gt range matches across cache entries", async () => {
  const a = await seededAugmenter();
  const r = a.matchMultiplePredicates([
    { kind: "gt", column: "lastAccessed", value: "2026-04-29T07:30:00.000" },
  ])!;
  expect([...r.cacheKeys].sort()).toEqual(["Beta", "Charlie"]);
  expect(r.needsUniverse).toBe(false);
});

test("matchMultiplePredicates: is-not-nil matches only entries with the column", async () => {
  const a = await seededAugmenter();
  const r = a.matchMultiplePredicates([
    { kind: "is-not-nil", column: "lastAccessed" },
  ])!;
  expect([...r.cacheKeys].sort()).toEqual(["Alpha", "Beta", "Charlie"]);
  expect(r.needsUniverse).toBe(false);
});

test("matchMultiplePredicates: is-nil only flags entries missing the column AND signals needsUniverse", async () => {
  const a = await seededAugmenter();
  const r = a.matchMultiplePredicates([
    { kind: "is-nil", column: "lastAccessed" },
  ])!;
  // Delta has the cache entry but no lastAccessed column.
  expect([...r.cacheKeys].sort()).toEqual(["Delta"]);
  // The caller must union with universe-minus-cache for keys not in
  // the augmenter at all.
  expect(r.needsUniverse).toBe(true);
});

test("matchMultiplePredicates: cache-bound + is-nil on different columns AND-narrows within cache (no universe needed)", async () => {
  const a = await seededAugmenter();
  const r = a.matchMultiplePredicates([
    { kind: "is-not-nil", column: "lastAccessed" },
    { kind: "is-nil", column: "pinned" },
  ])!;
  expect([...r.cacheKeys].sort()).toEqual(["Alpha", "Beta"]);
  expect(r.needsUniverse).toBe(false);
});

test("matchMultiplePredicates: type-mismatched eq returns no match (strict typing)", async () => {
  const a = await seededAugmenter();
  const r = a.matchMultiplePredicates([
    { kind: "eq", column: "lastAccessed", value: 123 },
  ])!;
  expect(r.cacheKeys.size).toBe(0);
  expect(r.needsUniverse).toBe(false);
});

test("matchMultiplePredicates: neq with type mismatch matches all present entries (Postgres semantics)", async () => {
  const a = await seededAugmenter();
  const r = a.matchMultiplePredicates([
    { kind: "neq", column: "lastAccessed", value: 123 },
  ])!;
  expect([...r.cacheKeys].sort()).toEqual(["Alpha", "Beta", "Charlie"]);
  expect(r.needsUniverse).toBe(false);
});

test("engineSpec advertises augmenter id and unified pred-* capabilities", async () => {
  const a = await seededAugmenter();
  const spec = a.engineSpec("page");
  expect(spec.id).toBe("augmenter-overlay-page");
  expect(spec.kind).toBe("overlay");
  expect(spec.priority).toBe(25);
  expect(spec.capabilities).toContain("scan-augmenter");
  expect(spec.capabilities).toContain("pred-eq");
  expect(spec.capabilities).toContain("pred-gt");
  expect(spec.capabilities).toContain("pred-is-nil");
  expect(spec.capabilities).toContain("pred-is-not-nil");
  expect(spec.metadata?.overlay).toBe("page");
  expect(spec.capabilities).not.toContain("aug-eq" as any);
  expect(spec.capabilities).not.toContain("stats-aug-row-count" as any);
});
