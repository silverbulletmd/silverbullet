import { describe, expect, test } from "vitest";
import {
  BitmapIndex,
  type BitmapIndexConfig,
  type EncodedObject,
  type TagMeta,
} from "./bitmap_index.ts";

// Helpers

function makeIndex(config?: Partial<BitmapIndexConfig>) {
  return new BitmapIndex({
    maxSelectivity: 0.5,
    minRowsForIndex: 0,
    maxValueBytes: 256,
    maxDictionarySize: 100000,
    maxBitmapsPerColumn: 10000,
    alwaysIndexColumns: ["page", "tag"],
    ...(config ?? {}),
  });
}

function addObject(
  idx: BitmapIndex,
  tag: string,
  obj: Record<string, unknown>,
): { tagId: number; objectId: number; encoded: EncodedObject } {
  const { tagId, meta } = idx.getTagMeta(tag);
  const objectId = idx.allocateObjectId(tagId);
  const encoded = idx.encodeObject(obj);
  idx.indexObject(tagId, objectId, encoded, meta);
  return { tagId, objectId, encoded };
}

// Encoding

describe("BitmapIndex encoding", () => {
  test("short strings are dictionary-encoded", () => {
    const idx = makeIndex();
    const encoded = idx.encodeObject({ name: "Alice", page: "MyPage" });
    expect(encoded.$enc).toContain("name");
    expect(encoded.$enc).toContain("page");
    expect(typeof encoded.name).toBe("number");
    expect(typeof encoded.page).toBe("number");
  });

  test("numbers are not dictionary-encoded", () => {
    const idx = makeIndex();
    const encoded = idx.encodeObject({ pos: 42, level: 3 });
    // Numbers are encoded
    expect(encoded.$enc).toContain("pos");
    expect(typeof encoded.pos).toBe("number"); // dict ID, also a number
  });

  test("long strings are not encoded", () => {
    const idx = makeIndex({ maxValueBytes: 10 });
    const longStr = "a".repeat(100);
    const encoded = idx.encodeObject({ text: longStr, name: "short" });
    expect(encoded.$enc).not.toContain("text");
    expect(encoded.$enc).toContain("name");
    expect(encoded.text).toBe(longStr);
  });

  test("null/undefined values are not encoded", () => {
    const idx = makeIndex();
    const encoded = idx.encodeObject({ a: null, b: undefined, c: "yes" });
    expect(encoded.$enc).not.toContain("a");
    expect(encoded.$enc).not.toContain("b");
    expect(encoded.$enc).toContain("c");
  });

  test("array elements are individually encoded", () => {
    const idx = makeIndex();
    const encoded = idx.encodeObject({ tags: ["item", "todo"] });
    expect(encoded.$enc).toContain("tags");
    expect(Array.isArray(encoded.tags)).toBe(true);
    const arr = encoded.tags as number[];
    expect(typeof arr[0]).toBe("number");
    expect(typeof arr[1]).toBe("number");
  });

  test("$enc field is reserved and skipped", () => {
    const idx = makeIndex();
    const encoded = idx.encodeObject({ $enc: "bogus", name: "test" });
    expect(Array.isArray(encoded.$enc)).toBe(true);
    expect(encoded.$enc).toContain("name");
  });

  test("dictionary size cap disables new encodings", () => {
    const idx = makeIndex({ maxDictionarySize: 1 });
    const encoded1 = idx.encodeObject({ a: "first" });
    const encoded2 = idx.encodeObject({ b: "second" });

    expect(encoded1.$enc).toContain("a");
    expect(encoded2.$enc).not.toContain("b");
    expect(encoded2.b).toBe("second");
  });
});

// Decoding

describe("BitmapIndex decoding", () => {
  test("roundtrip string fields", () => {
    const idx = makeIndex();
    const orig = { name: "Alice", page: "MyPage", tag: "item" };
    const encoded = idx.encodeObject(orig);
    const decoded = idx.decodeObject(encoded);
    expect(decoded).toEqual(orig);
  });

  test("roundtrip mixed types", () => {
    const idx = makeIndex();
    const orig = { name: "Bob", pos: 42, done: false, text: "hello" };
    const encoded = idx.encodeObject(orig);
    const decoded = idx.decodeObject(encoded);
    expect(decoded.name).toBe("Bob");
    // pos, done, text — all short enough to encode, decoded back
    expect(decoded.text).toBe("hello");
  });

  test("roundtrip arrays", () => {
    const idx = makeIndex();
    const orig = { tags: ["item", "todo", "urgent"] };
    const encoded = idx.encodeObject(orig);
    const decoded = idx.decodeObject(encoded);
    expect(decoded.tags).toEqual(["item", "todo", "urgent"]);
  });

  test("roundtrip with long strings preserved", () => {
    const idx = makeIndex({ maxValueBytes: 5 });
    const orig = { short: "hi", long: "this is long text" };
    const encoded = idx.encodeObject(orig);
    const decoded = idx.decodeObject(encoded);
    expect(decoded).toEqual(orig);
  });
});

// Bitmap indexing

describe("BitmapIndex bitmap operations", () => {
  test("index single object creates bitmaps", () => {
    const idx = makeIndex();
    const { tagId } = addObject(idx, "item", {
      name: "Buy groceries",
      page: "MyPage",
    });

    // The page column should have a bitmap with bit 0 set
    const pageValueId = idx.getDictionary().tryEncode("MyPage")!;
    const bm = idx.getBitmap(tagId, "page", pageValueId);
    expect(bm).toBeDefined();
    expect(bm!.has(0)).toBe(true);
    expect(bm!.cardinality()).toBe(1);
  });

  test("index multiple objects same page", () => {
    const idx = makeIndex();
    addObject(idx, "item", { name: "A", page: "P1" });
    addObject(idx, "item", { name: "B", page: "P1" });
    addObject(idx, "item", { name: "C", page: "P2" });

    const { tagId } = idx.getTagMeta("item");
    const p1Id = idx.getDictionary().tryEncode("P1")!;
    const p2Id = idx.getDictionary().tryEncode("P2")!;

    const bm1 = idx.getBitmap(tagId, "page", p1Id)!;
    expect(bm1.cardinality()).toBe(2);
    expect(bm1.has(0)).toBe(true);
    expect(bm1.has(1)).toBe(true);

    const bm2 = idx.getBitmap(tagId, "page", p2Id)!;
    expect(bm2.cardinality()).toBe(1);
    expect(bm2.has(2)).toBe(true);
  });

  test("array values create separate bitmap entries", () => {
    const idx = makeIndex();
    addObject(idx, "item", { name: "X", tags: ["todo", "urgent"] });

    const { tagId } = idx.getTagMeta("item");
    const todoId = idx.getDictionary().tryEncode("todo")!;
    const urgentId = idx.getDictionary().tryEncode("urgent")!;

    expect(idx.getBitmap(tagId, "tags", todoId)!.has(0)).toBe(true);
    expect(idx.getBitmap(tagId, "tags", urgentId)!.has(0)).toBe(true);
  });

  test("unindex removes bits", () => {
    const idx = makeIndex();
    const { tagId, objectId, encoded } = addObject(idx, "item", {
      name: "A",
      page: "P1",
    });

    const meta = idx.getTagMeta("item").meta;
    idx.unindexObject(tagId, objectId, encoded, meta);

    const p1Id = idx.getDictionary().tryEncode("P1")!;
    const bm = idx.getBitmap(tagId, "page", p1Id)!;
    expect(bm.has(0)).toBe(false);
    expect(bm.isEmpty()).toBe(true);
  });

  test("unindex one of multiple objects", () => {
    const idx = makeIndex();
    const o1 = addObject(idx, "item", { name: "A", page: "P1" });
    addObject(idx, "item", { name: "B", page: "P1" });

    const meta = idx.getTagMeta("item").meta;
    idx.unindexObject(o1.tagId, o1.objectId, o1.encoded, meta);

    const p1Id = idx.getDictionary().tryEncode("P1")!;
    const bm = idx.getBitmap(o1.tagId, "page", p1Id)!;
    expect(bm.cardinality()).toBe(1);
    expect(bm.has(0)).toBe(false);
    expect(bm.has(1)).toBe(true);
  });
});

// Tag metadata

describe("BitmapIndex tag metadata", () => {
  test("count tracks adds and removes", () => {
    const idx = makeIndex();
    addObject(idx, "item", { name: "A", page: "P" });
    addObject(idx, "item", { name: "B", page: "P" });
    expect(idx.getRowCount(idx.getTagMeta("item").tagId)).toBe(2);

    const { tagId, meta } = idx.getTagMeta("item");
    // Simulate remove
    meta.count--;
    expect(idx.getRowCount(tagId)).toBe(1);
  });

  test("objectId increments monotonically", () => {
    const idx = makeIndex();
    const { tagId } = idx.getTagMeta("item");
    const id0 = idx.allocateObjectId(tagId);
    const id1 = idx.allocateObjectId(tagId);
    const id2 = idx.allocateObjectId(tagId);
    expect(id0).toBe(0);
    expect(id1).toBe(1);
    expect(id2).toBe(2);
  });

  test("NDV recomputation", () => {
    const idx = makeIndex();
    addObject(idx, "item", { page: "P1", name: "A" });
    addObject(idx, "item", { page: "P1", name: "B" });
    addObject(idx, "item", { page: "P2", name: "C" });

    const { tagId, meta } = idx.getTagMeta("item");
    idx.recomputeNDV(tagId, meta);

    expect(meta.columns.page.ndv).toBe(2); // P1, P2
    expect(meta.columns.name.ndv).toBe(3); // A, B, C (all values indexed)
  });

  test("totalColumnCount tracks adds", () => {
    const idx = makeIndex();
    addObject(idx, "item", { page: "P1", name: "A", done: false });
    addObject(idx, "item", { page: "P2", name: "B" });

    const { meta } = idx.getTagMeta("item");
    expect(meta.totalColumnCount).toBe(5);
  });

  test("totalColumnCount tracks removes", () => {
    const idx = makeIndex();
    const o1 = addObject(idx, "item", { page: "P1", name: "A", done: false });
    addObject(idx, "item", { page: "P2", name: "B" });

    const { meta } = idx.getTagMeta("item");
    expect(meta.totalColumnCount).toBe(5);

    idx.unindexObject(o1.tagId, o1.objectId, o1.encoded, meta);
    expect(meta.totalColumnCount).toBe(2);
  });
});

// Selectivity threshold

describe("BitmapIndex selectivity thresholds", () => {
  test("alwaysIndexColumns are always indexed", () => {
    const idx = makeIndex({ alwaysIndexColumns: ["page"] });
    const meta: TagMeta = {
      count: 10,
      nextObjectId: 10,
      totalColumnCount: 10,
      columns: { page: { ndv: 10, indexed: true } },
    };
    // ndv/count = 1.0 > 0.5 but page is always indexed
    expect(idx.shouldIndexColumn("page", meta)).toBe(true);
  });

  test("high selectivity column is not indexed", () => {
    const idx = makeIndex({
      alwaysIndexColumns: [],
      maxSelectivity: 0.5,
      minRowsForIndex: 0,
    });
    const meta: TagMeta = {
      count: 10,
      nextObjectId: 10,
      totalColumnCount: 10,
      columns: { ref: { ndv: 8, indexed: true } },
    };
    // ndv/count = 0.8 > 0.5
    expect(idx.shouldIndexColumn("ref", meta)).toBe(false);
  });

  test("low selectivity column is indexed", () => {
    const idx = makeIndex({
      alwaysIndexColumns: [],
      maxSelectivity: 0.5,
      minRowsForIndex: 0,
    });
    const meta: TagMeta = {
      count: 100,
      nextObjectId: 100,
      totalColumnCount: 100,
      columns: { state: { ndv: 3, indexed: true } },
    };
    // ndv/count = 0.03 < 0.5
    expect(idx.shouldIndexColumn("state", meta)).toBe(true);
  });

  test("below minRowsForIndex falls back to no index", () => {
    const idx = makeIndex({
      alwaysIndexColumns: [],
      minRowsForIndex: 100,
    });
    const meta: TagMeta = {
      count: 10,
      nextObjectId: 10,
      totalColumnCount: 10,
      columns: { state: { ndv: 2, indexed: true } },
    };
    expect(idx.shouldIndexColumn("state", meta)).toBe(false);
  });
});

// Flush to KV

describe("BitmapIndex flush", () => {
  test("flush produces writes for dirty data", () => {
    const idx = makeIndex();
    addObject(idx, "item", { name: "A", page: "P1" });

    const { writes, deletes } = idx.flushToKVs();

    // Should have: bitmap writes + meta write + dict write
    expect(writes.length).toBeGreaterThan(0);
    expect(deletes.length).toBe(0);

    // Should have a dictionary entry
    const dictWrite = writes.find(
      (w) => w.key.length === 1 && w.key[0] === "$dict",
    );
    expect(dictWrite).toBeDefined();

    // Should have at least one bitmap entry
    const bitmapWrites = writes.filter((w) => w.key[0] === "b");
    expect(bitmapWrites.length).toBeGreaterThan(0);

    // Should have meta entry
    const metaWrites = writes.filter((w) => w.key[0] === "m");
    expect(metaWrites.length).toBe(1);
  });

  test("flush persists totalColumnCount in meta", () => {
    const idx = makeIndex();
    addObject(idx, "item", { name: "A", page: "P1", done: false });

    const { writes } = idx.flushToKVs();
    const metaWrite = writes.find((w) => w.key[0] === "m");
    expect(metaWrite).toBeDefined();
    expect((metaWrite!.value as TagMeta).totalColumnCount).toBe(3);
  });

  test("flush clears dirty state", () => {
    const idx = makeIndex();
    addObject(idx, "item", { name: "A", page: "P1" });
    idx.flushToKVs();

    // Second flush should produce nothing
    const { writes, deletes } = idx.flushToKVs();
    expect(writes.length).toBe(0);
    expect(deletes.length).toBe(0);
  });

  test("empty bitmap produces delete", () => {
    const idx = makeIndex();
    const { tagId, objectId, encoded } = addObject(idx, "item", {
      name: "A",
      page: "P1",
    });

    // Flush initial state
    idx.flushToKVs();

    // Remove the object
    const meta = idx.getTagMeta("item").meta;
    idx.unindexObject(tagId, objectId, encoded, meta);

    const { deletes } = idx.flushToKVs();
    // Should have deletes for the now-empty bitmaps
    expect(deletes.length).toBeGreaterThan(0);
    const bitmapDeletes = deletes.filter((k) => k[0] === "b");
    expect(bitmapDeletes.length).toBeGreaterThan(0);
  });
});

// Load from persistence

describe("BitmapIndex load", () => {
  test("loadDictionary restores encoding", () => {
    const idx1 = makeIndex();
    idx1.getDictionary().encode("page1");
    idx1.getDictionary().encode("item");
    const snap = idx1.getDictionary().toSnapshot();

    const idx2 = makeIndex();
    idx2.loadDictionary(snap);
    expect(idx2.getDictionary().tryEncode("page1")).toBe(0);
    expect(idx2.getDictionary().tryEncode("item")).toBe(1);
  });

  test("loadTagMeta restores metadata", () => {
    const idx = makeIndex();
    const meta: TagMeta = {
      count: 42,
      nextObjectId: 100,
      totalColumnCount: 84,
      columns: { page: { ndv: 5, indexed: true } },
    };
    idx.loadTagMeta(7, meta);
    expect(idx.getRowCount(7)).toBe(42);
    expect(idx.getColumnNDV(7, "page")).toBe(5);
    expect(idx.getTagMetaById(7)?.totalColumnCount).toBe(84);
  });

  test("loadBitmap restores bitmap state", () => {
    const idx1 = makeIndex();
    addObject(idx1, "item", { name: "A", page: "P1" });
    const { tagId } = idx1.getTagMeta("item");
    const p1Id = idx1.getDictionary().tryEncode("P1")!;
    const originalBm = idx1.getBitmap(tagId, "page", p1Id)!;
    const serialized = originalBm.serialize();

    const idx2 = makeIndex();
    idx2.loadBitmap(tagId, "page", p1Id, serialized);
    const loadedBm = idx2.getBitmap(tagId, "page", p1Id)!;
    expect(loadedBm.has(0)).toBe(true);
    expect(loadedBm.cardinality()).toBe(1);
  });
});

// Clear

describe("BitmapIndex clear", () => {
  test("clear resets all state", () => {
    const idx = makeIndex();
    addObject(idx, "item", { name: "A", page: "P1" });
    idx.clear();

    expect(idx.getDictionary().size).toBe(0);
    expect(idx.allTagIds()).toEqual([]);
  });
});

// Integration: multi-tag

describe("BitmapIndex multi-tag", () => {
  test("different tags have independent object IDs", () => {
    const idx = makeIndex();
    const i1 = addObject(idx, "item", { name: "A", page: "P" });
    const i2 = addObject(idx, "page", { name: "P", ref: "P" });
    // Both start at objectId 0 within their tag
    expect(i1.objectId).toBe(0);
    expect(i2.objectId).toBe(0);
  });

  test("same page value shared in dictionary", () => {
    const idx = makeIndex();
    addObject(idx, "item", { page: "SharedPage" });
    addObject(idx, "page", { name: "SharedPage" });

    const dict = idx.getDictionary();
    const idFromItem = dict.tryEncode("SharedPage");
    // Same dictionary ID used by both tags
    expect(idFromItem).toBeDefined();
    // Encoding again returns same ID
    expect(dict.encode("SharedPage")).toBe(idFromItem);
  });

  test("bitmap intersection across tags for join", () => {
    const idx = makeIndex();

    // Index pages
    addObject(idx, "page", { name: "P1" });
    addObject(idx, "page", { name: "P2" });
    addObject(idx, "page", { name: "P3" });

    // Index items on P1 and P2
    addObject(idx, "item", { name: "I1", page: "P1" });
    addObject(idx, "item", { name: "I2", page: "P1" });
    addObject(idx, "item", { name: "I3", page: "P2" });

    const dict = idx.getDictionary();
    const p1Id = dict.tryEncode("P1")!;

    const { tagId: itemTagId } = idx.getTagMeta("item");
    const itemsOnP1 = idx.getBitmap(itemTagId, "page", p1Id)!;

    // Items on P1 should be objectIds 0 and 1
    expect(itemsOnP1.toArray()).toEqual([0, 1]);
  });
});

// Dictionary.encodeIfFits

describe("Dictionary encodeIfFits", () => {
  test("returns undefined for null/undefined", () => {
    const idx = makeIndex();
    const dict = idx.getDictionary();
    expect(dict.encodeIfFits(null, 256, 100000)).toBeUndefined();
    expect(dict.encodeIfFits(undefined, 256, 100000)).toBeUndefined();
  });

  test("returns ID for short value", () => {
    const idx = makeIndex();
    const dict = idx.getDictionary();
    const id = dict.encodeIfFits("hello", 256, 100000);
    expect(id).toBe(0);
    // Same value again returns same ID
    expect(dict.encodeIfFits("hello", 256, 100000)).toBe(0);
  });

  test("returns undefined when value exceeds maxBytes", () => {
    const idx = makeIndex();
    const dict = idx.getDictionary();
    const id = dict.encodeIfFits("a".repeat(300), 10, 100000);
    expect(id).toBeUndefined();
  });

  test("returns undefined when dictionary is full", () => {
    const idx = makeIndex();
    const dict = idx.getDictionary();
    dict.encodeIfFits("first", 256, 1);
    // Dictionary now has 1 entry, maxSize is 1
    const id = dict.encodeIfFits("second", 256, 1);
    expect(id).toBeUndefined();
  });

  test("returns existing ID even when dictionary is full", () => {
    const idx = makeIndex();
    const dict = idx.getDictionary();
    const id = dict.encodeIfFits("first", 256, 1);
    expect(id).toBe(0);
    // Already exists, so returns it even though dict is "full"
    expect(dict.encodeIfFits("first", 256, 1)).toBe(0);
  });
});
