import { describe, expect, test } from "vitest";
import { ObjectIndex } from "./object_index.ts";
import { DataStore } from "./datastore.ts";
import { MemoryKvPrimitives } from "./memory_kv_primitives.ts";
import { DataStoreMQ } from "./mq.datastore.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { Config } from "../config.ts";
import { LuaEnv, LuaStackFrame } from "../space_lua/runtime.ts";
import { parseExpressionString } from "../space_lua/parse.ts";
import { Augmenter } from "./data_augmenter.ts";

function names(results: any[]): string[] {
  return results.map((r: any) => r.name ?? r.rawGet?.("name")).sort();
}

// Test helpers

function createTestIndex(config?: Config) {
  const kv = new MemoryKvPrimitives();
  const ds = new DataStore(kv);
  const cfg = config ?? new Config();
  const eventHook = new EventHook(cfg);
  const mq = new DataStoreMQ(ds, eventHook);
  const index = new ObjectIndex(ds, cfg, eventHook, mq, {
    minRowsForIndex: 0,
  });
  return { index, ds, kv, config: cfg };
}

// Basic indexing

describe("ObjectIndex indexObjects", () => {
  test("index and retrieve objects", async () => {
    const { index } = createTestIndex();

    await index.indexObjects("TestPage", [
      { tag: "item", ref: "TestPage@1", name: "Buy groceries" },
      { tag: "item", ref: "TestPage@2", name: "Write tests" },
    ]);

    const result = await index.getObjectByRef("TestPage", "item", "TestPage@1");
    expect(result).toBeTruthy();
    expect(result.name).toBe("Buy groceries");

    const result2 = await index.getObjectByRef(
      "TestPage",
      "item",
      "TestPage@2",
    );
    expect(result2).toBeTruthy();
    expect(result2.name).toBe("Write tests");
  });

  test("getObjectByRef returns null for nonexistent", async () => {
    const { index } = createTestIndex();
    const result = await index.getObjectByRef("X", "item", "X@999");
    expect(result).toBeNull();
  });

  test("index with multiple tags", async () => {
    const { index } = createTestIndex();

    await index.indexObjects("P", [
      { tag: "task", tags: ["item"], ref: "P@1", name: "A task" },
    ]);

    // Should be retrievable under both tags
    const asTask = await index.getObjectByRef("P", "task", "P@1");
    expect(asTask).toBeTruthy();
    expect(asTask.name).toBe("A task");

    const asItem = await index.getObjectByRef("P", "item", "P@1");
    expect(asItem).toBeTruthy();
    expect(asItem.name).toBe("A task");
  });
});

// Re-indexing (overwrite)

describe("ObjectIndex re-indexing", () => {
  test("re-indexing same ref overwrites", async () => {
    const { index } = createTestIndex();

    await index.indexObjects("P", [
      { tag: "item", ref: "P@1", name: "Version 1" },
    ]);

    await index.indexObjects("P", [
      { tag: "item", ref: "P@1", name: "Version 2" },
    ]);

    const result = await index.getObjectByRef("P", "item", "P@1");
    expect(result).toBeTruthy();
    expect(result.name).toBe("Version 2");
  });
});

// Delete

describe("ObjectIndex deleteObject", () => {
  test("delete removes object", async () => {
    const { index } = createTestIndex();

    await index.indexObjects("P", [
      { tag: "item", ref: "P@1", name: "To delete" },
    ]);

    await index.deleteObject("P", "item", "P@1");

    const result = await index.getObjectByRef("P", "item", "P@1");
    expect(result).toBeNull();
  });

  test("delete nonexistent is no-op", async () => {
    const { index } = createTestIndex();
    // Should not throw
    await index.deleteObject("P", "item", "P@999");
  });
});

// Clear file index

describe("ObjectIndex clearFileIndex", () => {
  test("clears all objects for a page", async () => {
    const { index } = createTestIndex();

    await index.indexObjects("Page1", [
      { tag: "item", ref: "Page1@1", name: "A" },
      { tag: "item", ref: "Page1@2", name: "B" },
    ]);
    await index.indexObjects("Page2", [
      { tag: "item", ref: "Page2@1", name: "C" },
    ]);

    await index.clearFileIndex("Page1");

    expect(await index.getObjectByRef("Page1", "item", "Page1@1")).toBeNull();
    expect(await index.getObjectByRef("Page1", "item", "Page1@2")).toBeNull();
    // Page2 should still be there
    const page2Obj = await index.getObjectByRef("Page2", "item", "Page2@1");
    expect(page2Obj).toBeTruthy();
    expect(page2Obj.name).toBe("C");
  });

  test("clears .md extension pages", async () => {
    const { index } = createTestIndex();

    await index.indexObjects("Notes", [
      { tag: "item", ref: "Notes@1", name: "Note" },
    ]);

    await index.clearFileIndex("Notes.md");

    expect(await index.getObjectByRef("Notes", "item", "Notes@1")).toBeNull();
  });
});

// Clear entire index

describe("ObjectIndex clearIndex", () => {
  test("clears everything", async () => {
    const { index } = createTestIndex();

    await index.indexObjects("P1", [{ tag: "item", ref: "P1@1", name: "X" }]);
    await index.indexObjects("P2", [{ tag: "page", ref: "P2", name: "P2" }]);

    await index.clearIndex();

    expect(await index.getObjectByRef("P1", "item", "P1@1")).toBeNull();
    expect(await index.getObjectByRef("P2", "page", "P2")).toBeNull();
  });
});

// Tag query

describe("ObjectIndex tag query", () => {
  test("tag().query returns all objects", async () => {
    const { index } = createTestIndex();

    await index.indexObjects("P", [
      { tag: "item", ref: "P@1", name: "A" },
      { tag: "item", ref: "P@2", name: "B" },
      { tag: "item", ref: "P@3", name: "C" },
    ]);

    const collection = index.tag("item");
    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const results = await collection.query({}, env, sf);

    expect(results).toHaveLength(3);
    const names = results.map((r: any) => r.name ?? r.rawGet?.("name"));
    expect(names.sort()).toEqual(["A", "B", "C"]);
  });

  test("tag().query with limit", async () => {
    const { index } = createTestIndex();

    await index.indexObjects("P", [
      { tag: "item", ref: "P@1", name: "A" },
      { tag: "item", ref: "P@2", name: "B" },
      { tag: "item", ref: "P@3", name: "C" },
    ]);

    const collection = index.tag("item");
    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const results = await collection.query({ limit: 2 }, env, sf);

    expect(results).toHaveLength(2);
  });

  test("tag() throws on empty name", () => {
    const { index } = createTestIndex();
    expect(() => index.tag("")).toThrow("Tag name is required");
  });
});

// Stats

describe("ObjectIndex stats", () => {
  test("getStats returns row count and NDV after full index completion", async () => {
    const { index } = createTestIndex();

    await index.indexObjects("P", [
      { tag: "item", ref: "P@1", name: "A", page: "P" },
      { tag: "item", ref: "P@2", name: "B", page: "P" },
      { tag: "item", ref: "P@3", name: "C", page: "Q" },
    ]);

    await index.markFullIndexComplete();

    const stats = await index.tag("item").getStats!();
    expect(stats).toBeDefined();
    expect(stats!.rowCount).toBe(3);
    // page column has 2 distinct values: P and Q
    expect(stats!.ndv.get("page")).toBe(2);
    // name column has 3 distinct values (all values are now indexed)
    expect(stats!.ndv.get("name")).toBe(3);
  });

  test("getStats for unknown tag returns zero", async () => {
    const { index } = createTestIndex();
    const stats = await index.tag("nonexistent").getStats!();
    expect(stats!.rowCount).toBe(0);
  });

  test("getStats advertises bitmap-extended capabilities when trusted", async () => {
    const { index } = createTestIndex();

    await index.indexObjects("P", [
      { tag: "item", ref: "P@1", page: "X" },
      { tag: "item", ref: "P@2", page: "Y" },
      { tag: "item", ref: "P@3", page: "Z" },
    ]);
    await index.markFullIndexComplete();

    const stats = await index.tag("item").getStats!();
    const caps = stats!.executionCapabilities!.engines[0].capabilities;
    expect(caps).toContain("pred-in");
    expect(caps).toContain("bool-or");
    expect(caps).toContain("bool-not");
    expect(caps).toContain("scan-bitmap");
    expect(caps).toContain("stage-where");
  });

  test("per-tag stats row reports bitmap-extended pushdown label", async () => {
    const { index } = createTestIndex();

    await index.indexObjects("P", [
      { tag: "item", ref: "P@1", page: "X" },
      { tag: "item", ref: "P@2", page: "Y" },
    ]);
    await index.markFullIndexComplete();

    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const rows = await (await index.stats("item")).query({}, env, sf);
    const tagRow = rows.find((r: any) => r.column === null);
    expect(tagRow!.predicatePushdown).toBe("bitmap-extended");
  });
});

// Validation

describe("ObjectIndex validation", () => {
  test("validates objects against schema", async () => {
    const cfg = new Config();
    cfg.set(["tags", "strict"], {
      mustValidate: true,
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          count: { type: "number" },
        },
        required: ["name"],
      },
    });

    const { index } = createTestIndex(cfg);

    // This should succeed (valid)
    await index.indexObjects("P", [
      { tag: "strict", ref: "P@1", name: "Valid", count: 5 },
    ]);

    const result = await index.getObjectByRef("P", "strict", "P@1");
    expect(result).toBeTruthy();
  });

  test("validateObjects throws on invalid", async () => {
    const cfg = new Config();
    cfg.set(["tags", "strict"], {
      mustValidate: true,
      schema: {
        type: "object",
        required: ["name"],
      },
    });

    const { index } = createTestIndex(cfg);

    await expect(
      index.validateObjects("P", [{ tag: "strict", ref: "P@1" } as any]),
    ).rejects.toThrow();
  });
});

// Bitmap predicate pushdown

describe("ObjectIndex bitmap pushdown", () => {
  async function seedPages(index: ObjectIndex) {
    await index.indexObjects("P", [
      { tag: "item", ref: "P@1", name: "A", page: "X" },
      { tag: "item", ref: "P@2", name: "B", page: "Y" },
      { tag: "item", ref: "P@3", name: "C", page: "Z" },
      { tag: "item", ref: "P@4", name: "D", page: "X" },
      { tag: "item", ref: "P@5", name: "E", page: "W" },
    ]);
    await index.markFullIndexComplete();
  }

  test("pred-in: `page in {X, Y}` is answered via bitmap union", async () => {
    const { index } = createTestIndex();
    await seedPages(index);

    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const where = parseExpressionString("o.page in {'X', 'Y'}");
    const results = await index
      .tag("item")
      .query({ where, objectVariable: "o" }, env, sf);
    expect(names(results)).toEqual(["A", "B", "D"]);
  });

  test("bool-or: same-column equality chain collapses to bitmap IN", async () => {
    const { index } = createTestIndex();
    await seedPages(index);

    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const where = parseExpressionString(
      "o.page == 'X' or o.page == 'Y' or o.page == 'Z'",
    );
    const results = await index
      .tag("item")
      .query({ where, objectVariable: "o" }, env, sf);
    expect(names(results)).toEqual(["A", "B", "C", "D"]);
  });

  test("bool-not: `not (page in {X, Y})` rewrites to neq conjunction", async () => {
    const { index } = createTestIndex();
    await seedPages(index);

    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const where = parseExpressionString("not (o.page in {'X', 'Y'})");
    const results = await index
      .tag("item")
      .query({ where, objectVariable: "o" }, env, sf);
    expect(names(results)).toEqual(["C", "E"]);
  });

  test("pred-in combined with AND of range predicate", async () => {
    const { index } = createTestIndex();
    await index.indexObjects("P", [
      { tag: "item", ref: "P@1", name: "A", page: "X", count: 10 },
      { tag: "item", ref: "P@2", name: "B", page: "Y", count: 20 },
      { tag: "item", ref: "P@3", name: "C", page: "Z", count: 30 },
      { tag: "item", ref: "P@4", name: "D", page: "X", count: 40 },
      { tag: "item", ref: "P@5", name: "E", page: "W", count: 50 },
    ]);
    await index.markFullIndexComplete();

    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const where = parseExpressionString(
      "o.page in {'X', 'Y'} and o.count >= 20",
    );
    const results = await index
      .tag("item")
      .query({ where, objectVariable: "o" }, env, sf);
    expect(names(results)).toEqual(["B", "D"]);
  });

  test("pred-in with single value behaves like equality", async () => {
    const { index } = createTestIndex();
    await seedPages(index);

    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const where = parseExpressionString("o.page in {'Y'}");
    const results = await index
      .tag("item")
      .query({ where, objectVariable: "o" }, env, sf);
    expect(names(results)).toEqual(["B"]);
  });

  test("pred-in with value not in dictionary returns empty set", async () => {
    const { index } = createTestIndex();
    await seedPages(index);

    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const where = parseExpressionString("o.page in {'nope', 'also-nope'}");
    const results = await index
      .tag("item")
      .query({ where, objectVariable: "o" }, env, sf);
    expect(results).toHaveLength(0);
  });

  test("bool-or on different columns falls back to full scan (no bitmap push)", async () => {
    const { index } = createTestIndex();
    await seedPages(index);

    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const where = parseExpressionString("o.page == 'X' or o.name == 'C'");
    const results = await index
      .tag("item")
      .query({ where, objectVariable: "o" }, env, sf);
    expect(names(results)).toEqual(["A", "C", "D"]);
  });
});

// cleanKey

describe("ObjectIndex cleanKey", () => {
  test("strips page prefix from ref", () => {
    const { index } = createTestIndex();
    expect(index.cleanKey("MyPage@42", "MyPage")).toBe("42");
  });

  test("leaves ref without page prefix unchanged", () => {
    const { index } = createTestIndex();
    expect(index.cleanKey("other@42", "MyPage")).toBe("other@42");
  });
});

// Virtual columns from Augmenter (e.g. lastAccessed)

describe("ObjectIndex augmenter virtual column", () => {
  async function seedPagesWithAugmenter() {
    const { index, ds } = createTestIndex();
    const augmenter = new Augmenter(ds, ["aug", "pageMeta"]);
    index.registerAugmenter("page", augmenter);

    await index.indexObjects("Alpha", [
      {
        tag: "page",
        ref: "Alpha",
        name: "Alpha",
        created: "2026-01-01T08:00:00.000",
        lastModified: "2026-01-02T08:00:00.000",
        perm: "rw",
      },
    ]);
    await index.indexObjects("Beta", [
      {
        tag: "page",
        ref: "Beta",
        name: "Beta",
        created: "2026-01-01T08:00:00.000",
        lastModified: "2026-01-03T08:00:00.000",
        perm: "rw",
      },
    ]);
    await index.indexObjects("Gamma", [
      {
        tag: "page",
        ref: "Gamma",
        name: "Gamma",
        created: "2026-01-01T08:00:00.000",
        lastModified: "2026-01-04T08:00:00.000",
        perm: "rw",
      },
    ]);
    await index.markFullIndexComplete();

    // Only Alpha and Gamma have ever been accessed.
    await augmenter.setAugmentation("Alpha", {
      lastAccessed: "2026-04-29T07:00:00.000",
    });
    await augmenter.setAugmentation("Gamma", {
      lastAccessed: "2026-04-29T08:00:00.000",
    });

    return { index, augmenter };
  }

  test("query overlays lastAccessed; unaugmented rows expose the column as null", async () => {
    // Schema-fill contract: every row of an augmented tag carries
    // every known virtual-column key (`lastAccessed` here), with
    // `null` when the row has no augmentation. This makes the
    // tag's row-shape uniform across augmented / unaugmented
    // rows, so `select *` and `select name, lastAccessed`
    // surface the column even when picking an unaugmented row
    // (`limit 1` from a tag where the first physical entry happens
    // to lack augmentation). Augmented rows continue to carry
    // their actual cached values.
    const { index } = await seedPagesWithAugmenter();
    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;

    const results = await index.tag("page").query({}, env, sf);
    const byName: Record<string, any> = Object.fromEntries(
      results.map((r: any) => [r.name, r]),
    );
    expect(byName.Alpha.lastAccessed).toBe("2026-04-29T07:00:00.000");
    expect(byName.Gamma.lastAccessed).toBe("2026-04-29T08:00:00.000");
    // Pre-fix this was `undefined` (key absent). Post-fix the key
    // exists with a `null` value -- consistent shape, same
    // truthiness for `where lastAccessed`.
    expect(byName.Beta.lastAccessed).toBeNull();
    expect("lastAccessed" in byName.Beta).toBe(true);
  });

  test(
    "no-WHERE full scan: every row carries the virtual-column key " +
      "(reproduces `select name, lastAccessed limit 1` bug)",
    async () => {
      const { index } = await seedPagesWithAugmenter();
      const env = new LuaEnv();
      const sf = LuaStackFrame.lostFrame;

      const results = await index.tag("page").query({}, env, sf);
      // Every row, augmented or not, MUST expose the lastAccessed
      // key. Otherwise an explicit `select lastAccessed` (or
      // `select *`) yields a row whose shape silently omits the
      // column.
      for (const row of results) {
        expect("lastAccessed" in (row as any)).toBe(true);
      }
    },
  );

  test(
    "declared virtual columns surface even when cache is empty " +
      "(reproduces missing `lastAccessed` on `from index.tag 'document'` " +
      "with no recorded accesses)",
    async () => {
      const { index, ds } = createTestIndex();
      // Augmenter declares `lastAccessed` but its cache stays empty.
      const augmenter = new Augmenter(
        ds,
        ["aug", "pageMeta"],
        ["lastAccessed"],
      );
      index.registerAugmenter("page", augmenter);

      await index.indexObjects("Alpha", [
        { tag: "page", ref: "Alpha", name: "Alpha", perm: "rw" },
      ]);
      await index.markFullIndexComplete();

      const env = new LuaEnv();
      const sf = LuaStackFrame.lostFrame;
      const results = await index.tag("page").query({}, env, sf);

      expect(results.length).toBe(1);
      expect("lastAccessed" in (results[0] as any)).toBe(true);
      expect((results[0] as any).lastAccessed).toBeNull();
    },
  );

  test("WHERE on virtual column: range predicate filters correctly", async () => {
    const { index } = await seedPagesWithAugmenter();
    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const where = parseExpressionString(
      "p.lastAccessed != nil and p.lastAccessed > '2026-04-29T07:30:00.000'",
    );

    const results = await index
      .tag("page")
      .query({ where, objectVariable: "p" }, env, sf);

    expect(names(results)).toEqual(["Gamma"]);
  });

  test("WHERE: lastAccessed > created keeps only rows with overlay", async () => {
    const { index } = await seedPagesWithAugmenter();
    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const where = parseExpressionString(
      "p.lastAccessed != nil and p.lastAccessed > p.created",
    );

    const results = await index
      .tag("page")
      .query({ where, objectVariable: "p" }, env, sf);
    expect(names(results)).toEqual(["Alpha", "Gamma"]);
  });

  test("indexed columns win over augmenter overlay (no clobber)", async () => {
    const { index, ds } = createTestIndex();
    const augmenter = new Augmenter(ds, ["aug", "pageMeta"]);
    index.registerAugmenter("page", augmenter);

    await index.indexObjects("X", [
      {
        tag: "page",
        ref: "X",
        name: "X-from-index",
        created: "2026-01-01T00:00:00.000",
        lastModified: "2026-01-02T00:00:00.000",
        perm: "rw",
      },
    ]);
    await index.markFullIndexComplete();

    // Try to clobber `name` from the augmenter — must be ignored.
    await augmenter.setAugmentation("X", {
      name: "X-from-augmenter",
      lastAccessed: "2026-04-29T07:00:00.000",
    });

    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const [row] = await index.tag("page").query({}, env, sf);
    expect(row.name).toBe("X-from-index");
    expect(row.lastAccessed).toBe("2026-04-29T07:00:00.000");
  });

  test("no augmenter registered: tag query unchanged", async () => {
    const { index } = createTestIndex();
    await index.indexObjects("P", [{ tag: "item", ref: "P@1", name: "A" }]);
    await index.markFullIndexComplete();

    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const [row] = await index.tag("item").query({}, env, sf);
    expect(row.name).toBe("A");
    expect(row.lastAccessed).toBeUndefined();
  });

  test("stats() reports augmenter columns with non-pushdown metadata", async () => {
    const { index } = await seedPagesWithAugmenter();
    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;

    const rows = await (await index.stats("page")).query({}, env, sf);
    const augRow = rows.find((r: any) => r.column === "lastAccessed");
    expect(augRow).toBeDefined();
    expect(augRow!.statsSource).toBe("augmenter");
    expect(augRow!.scanKind).toBe("augmenter-overlay");
    expect(augRow!.predicatePushdown).toBe("none");
    expect(augRow!.indexed).toBe(false);
    // 2 of 3 pages have been accessed
    expect(augRow!.rowCount).toBe(2);
    // Two distinct timestamps
    expect(augRow!.ndv).toBe(2);
  });

  test("stats(): bitmap-indexed columns retain pushdown metadata", async () => {
    const { index } = await seedPagesWithAugmenter();
    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;

    const rows = await (await index.stats("page")).query({}, env, sf);
    const lastModifiedRow = rows.find((r: any) => r.column === "lastModified");
    expect(lastModifiedRow).toBeDefined();
    expect(lastModifiedRow!.scanKind).toBe("index-scan");
    expect(lastModifiedRow!.predicatePushdown).toBe("bitmap-extended");
    expect(lastModifiedRow!.statsSource).toBe("persisted-complete");
  });

  test("getStats() (planner-facing) does not advertise virtual columns", async () => {
    const { index } = await seedPagesWithAugmenter();
    const stats = await index.tag("page").getStats!();
    // The augmenter column has no NDV in the planner's view: it would be a
    // full scan column, so we must not lie about indexability.
    expect(stats!.ndv.has("lastAccessed")).toBe(false);
  });

  test("getStats() surfaces augmenter virtual columns for the planner", async () => {
    const { index } = await seedPagesWithAugmenter();
    const stats = await index.tag("page").getStats!();
    expect(stats!.virtualColumns).toBeDefined();
    const vc = stats!.virtualColumns!.find((v) => v.column === "lastAccessed");
    expect(vc).toBeDefined();
    expect(vc!.overlay).toBe("page");
    // 2 of 3 pages have been accessed (matches seed).
    expect(vc!.rowCount).toBe(2);
    expect(vc!.ndv).toBe(2);
  });

  test("getStats() registers a per-tag augmenter engine in executionCapabilities", async () => {
    const { index } = await seedPagesWithAugmenter();
    const stats = await index.tag("page").getStats!();
    const engines = stats!.executionCapabilities?.engines ?? [];
    const augEngine = engines.find((e) => e.id === "augmenter-overlay-page");
    expect(augEngine).toBeDefined();
    expect(augEngine!.kind).toBe("overlay");
    expect(augEngine!.priority).toBe(25);
    expect(augEngine!.metadata?.overlay).toBe("page");
    expect(augEngine!.capabilities).toContain("scan-augmenter");
    // Augmenter advertises the unified `pred-*` vocabulary, not a
    // parallel `aug-*` namespace.
    expect(augEngine!.capabilities).toContain("pred-eq");
    expect(augEngine!.capabilities).toContain("pred-is-nil");
    expect(augEngine!.capabilities).toContain("stats-row-count");
    // Bitmap engine remains; both engines must be advertised.
    expect(
      engines.find((e) => e.id === "object-index-bitmap-extended"),
    ).toBeDefined();
  });

  test("getStats() does NOT register augmenter engine when no augmenter is registered for the tag", async () => {
    // Build an index with `page` rows but NO augmenter registered.
    // Augmenter engine must be absent in that case.
    const { index } = createTestIndex();
    await index.indexObjects("Alpha", [
      {
        tag: "page",
        ref: "Alpha",
        name: "Alpha",
        created: "2026-01-01T08:00:00.000",
        lastModified: "2026-01-02T08:00:00.000",
        perm: "rw",
      },
    ]);
    await index.markFullIndexComplete();

    const stats = await index.tag("page").getStats!();
    const engines = stats!.executionCapabilities?.engines ?? [];
    expect(
      engines.find((e) => e.id?.startsWith("augmenter-overlay-")),
    ).toBeUndefined();
    // Bitmap engine is still present.
    expect(
      engines.find((e) => e.id === "object-index-bitmap-extended"),
    ).toBeDefined();
  });

  test("getStats() does NOT register augmenter engine when augmenter cache is empty", async () => {
    // Augmenter is registered but has no entries -> no virtual columns,
    // so the augmenter engine has nothing to advertise and must not be
    // emitted. This keeps the planner from picking up a useless engine
    // that contributes only overhead.
    const { index, ds } = createTestIndex();
    const augmenter = new Augmenter(ds, ["aug", "pageMeta"]);
    index.registerAugmenter("page", augmenter);
    await index.indexObjects("Alpha", [
      {
        tag: "page",
        ref: "Alpha",
        name: "Alpha",
        created: "2026-01-01T08:00:00.000",
        lastModified: "2026-01-02T08:00:00.000",
        perm: "rw",
      },
    ]);
    await index.markFullIndexComplete();

    const stats = await index.tag("page").getStats!();
    const engines = stats!.executionCapabilities?.engines ?? [];
    expect(
      engines.find((e) => e.id?.startsWith("augmenter-overlay-")),
    ).toBeUndefined();
    expect(stats!.virtualColumns).toBeUndefined();
  });
});

describe("ObjectIndex augmenter lookup helpers", () => {
  async function seed() {
    const { index, ds } = createTestIndex();
    await index.indexObjects("Alpha", [
      { tag: "page", ref: "Alpha", name: "Alpha", perm: "rw" },
    ]);
    await index.indexObjects("Beta", [
      { tag: "page", ref: "Beta", name: "Beta", perm: "rw" },
    ]);
    await index.indexObjects("Gamma", [
      { tag: "page", ref: "Gamma", name: "Gamma", perm: "rw" },
    ]);
    await index.markFullIndexComplete();
    return { index, ds };
  }

  test("lookupObjectIdsByKeys: empty input returns []", async () => {
    const { index } = await seed();
    expect(await index.lookupObjectIdsByKeys("page", new Set())).toEqual([]);
  });

  test("lookupObjectIdsByKeys: resolves known refs to numeric object IDs", async () => {
    const { index } = await seed();
    const ids = await index.lookupObjectIdsByKeys(
      "page",
      new Set(["Alpha", "Gamma"]),
    );
    expect(ids.length).toBe(2);
    for (const id of ids) expect(typeof id).toBe("number");
  });

  test("lookupObjectIdsByKeys: silently skips refs with no reverse-index entry", async () => {
    const { index } = await seed();
    const ids = await index.lookupObjectIdsByKeys(
      "page",
      new Set(["Alpha", "Missing"]),
    );
    expect(ids.length).toBe(1);
  });

  test("allObjectIdsForTag: enumerates every object ID for the tag", async () => {
    const { index } = await seed();
    const ids = await index.allObjectIdsForTag("page");
    expect(ids.length).toBe(3);
    // Should be sorted ascending.
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    }
  });

  test("allObjectIdsForTag: unknown tag returns []", async () => {
    const { index } = await seed();
    expect(await index.allObjectIdsForTag("zzz-nope")).toEqual([]);
  });
});

describe("ObjectIndex augmenter dispatch in tag().query()", () => {
  async function seedFull() {
    const { index, ds } = createTestIndex();
    const augmenter = new Augmenter(ds, ["aug", "pageMeta"]);
    index.registerAugmenter("page", augmenter);

    await index.indexObjects("Alpha", [
      {
        tag: "page",
        ref: "Alpha",
        name: "Alpha",
        created: "2026-01-01T08:00:00.000",
        lastModified: "2026-01-02T08:00:00.000",
        perm: "rw",
      },
    ]);
    await index.indexObjects("Beta", [
      {
        tag: "page",
        ref: "Beta",
        name: "Beta",
        created: "2026-01-01T08:00:00.000",
        lastModified: "2026-01-03T08:00:00.000",
        perm: "rw",
      },
    ]);
    await index.indexObjects("Gamma", [
      {
        tag: "page",
        ref: "Gamma",
        name: "Gamma",
        created: "2026-01-01T08:00:00.000",
        lastModified: "2026-01-04T08:00:00.000",
        perm: "rw",
      },
    ]);
    await index.markFullIndexComplete();

    await augmenter.setAugmentation("Alpha", {
      lastAccessed: "2026-04-29T07:00:00.000",
    });
    await augmenter.setAugmentation("Gamma", {
      lastAccessed: "2026-04-29T08:00:00.000",
    });
    await augmenter.load();
    return { index, augmenter };
  }

  test("augmenter dispatch: is-not-nil narrows to augmented rows only", async () => {
    const { index } = await seedFull();
    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const where = parseExpressionString("p.lastAccessed ~= nil");
    const results = await index
      .tag("page")
      .query({ where, objectVariable: "p" }, env, sf);
    expect(names(results)).toEqual(["Alpha", "Gamma"]);
  });

  test("augmenter dispatch: is-nil pulls in non-cached rows from universe", async () => {
    const { index } = await seedFull();
    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const where = parseExpressionString("p.lastAccessed == nil");
    const results = await index
      .tag("page")
      .query({ where, objectVariable: "p" }, env, sf);
    // Beta has no augmenter entry -> is-nil satisfied via
    // universe-minus-cache.
    expect(names(results)).toEqual(["Beta"]);
  });

  test("augmenter dispatch + bitmap predicate: results are intersected", async () => {
    const { index } = await seedFull();
    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    // p.perm == 'rw' is a bitmap-pushable predicate (rw is indexed).
    // p.lastAccessed > '2026-04-29T07:30:00.000' is augmenter-pushable.
    // Only Gamma satisfies both.
    const where = parseExpressionString(
      "p.perm == 'rw' and p.lastAccessed > '2026-04-29T07:30:00.000'",
    );
    const results = await index
      .tag("page")
      .query({ where, objectVariable: "p" }, env, sf);
    expect(names(results)).toEqual(["Gamma"]);
  });

  test("augmenter dispatch produces same results as full-scan for value comparison", async () => {
    const { index } = await seedFull();
    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const where = parseExpressionString(
      "p.lastAccessed > '2026-04-29T07:30:00.000'",
    );
    const results = await index
      .tag("page")
      .query({ where, objectVariable: "p" }, env, sf);
    // Only Gamma's lastAccessed is > 07:30; Alpha is < 07:30; Beta has none.
    expect(names(results)).toEqual(["Gamma"]);
  });

  test(
    "perf-invariant: augmenter dispatch does NOT scan all objects when " +
      "the augmenter pre-narrows the candidate set (universe scan avoided)",
    async () => {
      // Build a larger fixture and assert that an augmenter-only predicate
      // never triggers the full `[indexKey, page]` KV scan path.
      const { index, ds } = createTestIndex();
      const augmenter = new Augmenter(ds, ["aug", "pageMeta"]);
      index.registerAugmenter("page", augmenter);

      // 50 pages, only 2 augmented.
      for (let i = 0; i < 50; i++) {
        const name = `Page${i.toString().padStart(2, "0")}`;
        await index.indexObjects(name, [
          {
            tag: "page",
            ref: name,
            name,
            created: "2026-01-01T08:00:00.000",
            lastModified: "2026-01-02T08:00:00.000",
            perm: "rw",
          },
        ]);
      }
      await index.markFullIndexComplete();

      await augmenter.setAugmentation("Page05", {
        lastAccessed: "2026-04-29T07:00:00.000",
      });
      await augmenter.setAugmentation("Page42", {
        lastAccessed: "2026-04-29T08:00:00.000",
      });
      await augmenter.load();

      // Spy on the underlying KV `query` and count [idx, page] scans.
      const originalQuery = ds.query.bind(ds);
      let pageIndexScanCount = 0;
      const wrappedQuery = (opts: any) => {
        const isPageTagScan =
          Array.isArray(opts?.prefix) &&
          opts.prefix[0] === "idx" &&
          opts.prefix[1] === "page" &&
          opts.prefix.length === 2;
        if (isPageTagScan) pageIndexScanCount++;
        return originalQuery(opts);
      };
      (ds as any).query = wrappedQuery;

      const env = new LuaEnv();
      const sf = LuaStackFrame.lostFrame;
      const where = parseExpressionString("p.lastAccessed ~= nil");
      const results = await index
        .tag("page")
        .query({ where, objectVariable: "p" }, env, sf);

      expect(names(results)).toEqual(["Page05", "Page42"]);
      // The full-scan fallback is never reached.
      expect(pageIndexScanCount).toBe(0);
    },
  );
});

describe("tag().query() onEngineDispatch reporting", () => {
  test("reports the augmenter engine when an augmenter predicate runs", async () => {
    const { index, ds } = createTestIndex();
    const augmenter = new Augmenter(ds, ["aug", "pageMeta"]);
    index.registerAugmenter("page", augmenter);

    await index.indexObjects("Page1", [
      { tag: "page", ref: "Page1", name: "Page1", perm: "rw" },
    ]);
    await index.indexObjects("Page2", [
      { tag: "page", ref: "Page2", name: "Page2", perm: "rw" },
    ]);
    await index.markFullIndexComplete();
    await augmenter.setAugmentation("Page1", {
      lastAccessed: "2026-04-29T07:00:00.000",
    });
    await augmenter.load();

    const reports: any[] = [];
    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const where = parseExpressionString("p.lastAccessed ~= nil");
    await index
      .tag("page")
      .query({ where, objectVariable: "p" }, env, sf, undefined, {
        onEngineDispatch: (rs) => reports.push(...rs),
      });

    // Augmenter claims `is-not-nil`; the bitmap engine declines (column
    // is not in its index). Only the augmenter run is reported.
    expect(reports.map((r) => r.engineId)).toEqual(["augmenter-overlay-page"]);
    expect(reports[0].contributed).toBe(true);
    expect(reports[0].engineKind).toBe("overlay");
  });

  test("reports the bitmap engine when a bitmap predicate runs", async () => {
    const { index } = createTestIndex();
    await index.indexObjects("Page1", [
      { tag: "page", ref: "Page1", name: "Page1", perm: "rw" },
    ]);
    await index.indexObjects("Page2", [
      { tag: "page", ref: "Page2", name: "Page2", perm: "rw" },
    ]);
    await index.markFullIndexComplete();

    const reports: any[] = [];
    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const where = parseExpressionString("p.tag == 'page'");
    await index
      .tag("page")
      .query({ where, objectVariable: "p" }, env, sf, undefined, {
        onEngineDispatch: (rs) => reports.push(...rs),
      });

    expect(reports.map((r) => r.engineId)).toEqual([
      "object-index-bitmap-extended",
    ]);
    expect(reports[0].contributed).toBe(true);
    expect(reports[0].engineKind).toBe("index");
  });

  test("reports BOTH bitmap AND augmenter engines when both can claim leaves", async () => {
    // a WHERE that mixes a bitmap-claimable leaf (`p.perm == 'rw'`,
    // a `pred-eq` on an indexed column) with
    // an augmenter-claimable leaf `p.lastAccessed ~= nil`,
    // an `is-not-nil` on an overlay column:
    // - each engine must claim its own leaf via `partitionConjuncts`;
    // - the dispatcher must intersect their id-sets;
    // - EXPLAIN must show BOTH engines under `Pushdown Capabilities:`.
    const { index, ds } = createTestIndex();
    const augmenter = new Augmenter(ds, ["aug", "pageMeta"]);
    index.registerAugmenter("page", augmenter);

    await index.indexObjects("Alpha", [
      { tag: "page", ref: "Alpha", name: "Alpha", perm: "rw" },
    ]);
    await index.indexObjects("Beta", [
      { tag: "page", ref: "Beta", name: "Beta", perm: "rw" },
    ]);
    await index.indexObjects("Gamma", [
      { tag: "page", ref: "Gamma", name: "Gamma", perm: "ro" },
    ]);
    await index.markFullIndexComplete();
    await augmenter.setAugmentation("Alpha", {
      lastAccessed: "2026-04-29T07:00:00.000",
    });
    await augmenter.setAugmentation("Gamma", {
      lastAccessed: "2026-04-29T08:00:00.000",
    });
    await augmenter.load();

    const reports: any[] = [];
    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    const where = parseExpressionString(
      "p.lastAccessed ~= nil and p.perm == 'rw'",
    );
    const result = await index
      .tag("page")
      .query({ where, objectVariable: "p" }, env, sf, undefined, {
        onEngineDispatch: (rs) => reports.push(...rs),
      });

    // Both engines must contribute:
    // - bitmap claims `perm == 'rw'`,
    // - augmenter claims `lastAccessed ~= nil`;
    // - the dispatcher intersects the two id-sets to Alpha;
    // - Beta has `rw` but no augmentation;
    // - Gamma has augmentation but ro.
    const ids = reports.map((r) => r.engineId).sort();
    expect(ids).toEqual([
      "augmenter-overlay-page",
      "object-index-bitmap-extended",
    ]);
    for (const r of reports) expect(r.contributed).toBe(true);

    expect(result.map((r) => r.ref).sort()).toEqual(["Alpha"]);
  });

  test("emits empty report when no engine claims (full-scan path)", async () => {
    const { index } = createTestIndex();
    await index.indexObjects("Page1", [
      { tag: "page", ref: "Page1", name: "Page1", perm: "rw" },
    ]);
    await index.markFullIndexComplete();

    const reports: any[] = [];
    const env = new LuaEnv();
    const sf = LuaStackFrame.lostFrame;
    // `p.nonexistent_col == 'x'` references a column that is not in
    // the bitmap index (and there is no augmenter registered for it
    // either). Both engines decline at plan() time, the dispatcher
    // returns no-claim, and `onEngineDispatch` fires with an empty
    // list. applyQuery still evaluates the WHERE row-by-row and
    // (correctly) returns zero matches because the column is nil.
    const where = parseExpressionString("p.nonexistent_col == 'x'");
    await index
      .tag("page")
      .query({ where, objectVariable: "p" }, env, sf, undefined, {
        onEngineDispatch: (rs) => reports.push(...rs),
      });

    expect(reports).toEqual([]);
  });
});
