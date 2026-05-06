import { describe, expect, test } from "vitest";
import { analyzeBitmapPrefilter } from "./bitmap_query.ts";
import { BitmapIndex } from "./bitmap_index.ts";
import type {
  LuaExpression,
  LuaBinaryExpression,
} from "../../space_lua/ast.ts";

// Helpers

function makeIndex(): BitmapIndex {
  return new BitmapIndex({
    maxSelectivity: 1.0,
    minRowsForIndex: 0,
    maxValueBytes: 256,
    maxDictionarySize: 100000,
    maxBitmapsPerColumn: 10000,
    alwaysIndexColumns: ["page", "tag", "name", "status"],
  });
}

function addObject(
  idx: BitmapIndex,
  tag: string,
  obj: Record<string, unknown>,
): { tagId: number; objectId: number } {
  const { tagId, meta } = idx.getTagMeta(tag);
  const objectId = idx.allocateObjectId(tagId);
  const encoded = idx.encodeObject(obj);
  idx.indexObject(tagId, objectId, encoded, meta);
  return { tagId, objectId };
}

// AST builders (no evaluation, just node construction)
function lit(value: string): LuaExpression {
  return { type: "String", value, ctx: {} };
}

function propAccess(obj: string, prop: string): LuaExpression {
  return {
    type: "PropertyAccess",
    object: { type: "Variable", name: obj, ctx: {} },
    property: prop,
    ctx: {},
  };
}

function varExpr(name: string): LuaExpression {
  return { type: "Variable", name, ctx: {} };
}

function binOp(
  operator: string,
  left: LuaExpression,
  right: LuaExpression,
): LuaBinaryExpression {
  return { type: "Binary", operator, left, right, ctx: {} };
}

function paren(expr: LuaExpression): LuaExpression {
  return { type: "Parenthesized", expression: expr, ctx: {} };
}

// Simple equality

describe("bitmap_query: equality pre-filter", () => {
  test("i.page == 'P1' narrows to matching IDs", () => {
    const idx = makeIndex();
    addObject(idx, "item", { page: "P1", name: "A" });
    addObject(idx, "item", { page: "P1", name: "B" });
    addObject(idx, "item", { page: "P2", name: "C" });

    const { tagId } = idx.getTagMeta("item");
    const expr = binOp("==", propAccess("i", "page"), lit("P1"));
    const result = analyzeBitmapPrefilter(expr, tagId, "i", idx);

    expect(result).not.toBeNull();
    expect(result!.candidateIds.toArray()).toEqual([0, 1]);
    expect(result!.resolvedColumns).toContain("page");
  });

  test("unknown value returns empty bitmap", () => {
    const idx = makeIndex();
    addObject(idx, "item", { page: "P1" });

    const { tagId } = idx.getTagMeta("item");
    const expr = binOp("==", propAccess("i", "page"), lit("NONEXISTENT"));
    const result = analyzeBitmapPrefilter(expr, tagId, "i", idx);

    expect(result).not.toBeNull();
    expect(result!.candidateIds.isEmpty()).toBe(true);
  });

  test("reversed: literal == column", () => {
    const idx = makeIndex();
    addObject(idx, "item", { page: "P1" });

    const { tagId } = idx.getTagMeta("item");
    const expr = binOp("==", lit("P1"), propAccess("i", "page"));
    const result = analyzeBitmapPrefilter(expr, tagId, "i", idx);

    expect(result).not.toBeNull();
    expect(result!.candidateIds.toArray()).toEqual([0]);
  });

  test("bare variable (unqualified query)", () => {
    const idx = makeIndex();
    addObject(idx, "item", { page: "P1" });

    const { tagId } = idx.getTagMeta("item");
    const expr = binOp("==", varExpr("page"), lit("P1"));
    const result = analyzeBitmapPrefilter(expr, tagId, undefined, idx);

    expect(result).not.toBeNull();
    expect(result!.candidateIds.toArray()).toEqual([0]);
  });
});

// AND chains

describe("bitmap_query: AND conjunction", () => {
  test("two equalities ANDed -> intersection", () => {
    const idx = makeIndex();
    addObject(idx, "item", { page: "P1", status: "open" });
    addObject(idx, "item", { page: "P1", status: "closed" });
    addObject(idx, "item", { page: "P2", status: "open" });

    const { tagId } = idx.getTagMeta("item");
    const expr = binOp(
      "and",
      binOp("==", propAccess("i", "page"), lit("P1")),
      binOp("==", propAccess("i", "status"), lit("open")),
    );

    const result = analyzeBitmapPrefilter(expr, tagId, "i", idx);
    expect(result).not.toBeNull();
    expect(result!.candidateIds.toArray()).toEqual([0]);
  });

  test("AND with unresolvable conjunct still uses resolvable part", () => {
    const idx = makeIndex();
    addObject(idx, "item", { page: "P1", name: "A" });
    addObject(idx, "item", { page: "P2", name: "B" });

    const { tagId } = idx.getTagMeta("item");
    // i.page == "P1" and i.name > "A" (> is not resolvable)
    const expr = binOp(
      "and",
      binOp("==", propAccess("i", "page"), lit("P1")),
      binOp(">", propAccess("i", "name"), lit("A")),
    );

    const result = analyzeBitmapPrefilter(expr, tagId, "i", idx);
    expect(result).not.toBeNull();
    // Bitmap narrows to page=="P1" objects; Lua eval handles the > predicate
    expect(result!.candidateIds.toArray()).toEqual([0]);
    expect(result!.resolvedColumns).toContain("page");
    expect(result!.resolvedColumns).not.toContain("name");
  });

  test("three-way AND chain", () => {
    const idx = makeIndex();
    addObject(idx, "item", { page: "P1", status: "open", tag: "todo" });
    addObject(idx, "item", { page: "P1", status: "closed", tag: "todo" });
    addObject(idx, "item", { page: "P1", status: "open", tag: "done" });
    addObject(idx, "item", { page: "P2", status: "open", tag: "todo" });

    const { tagId } = idx.getTagMeta("item");
    const expr = binOp(
      "and",
      binOp(
        "and",
        binOp("==", propAccess("i", "page"), lit("P1")),
        binOp("==", propAccess("i", "status"), lit("open")),
      ),
      binOp("==", propAccess("i", "tag"), lit("todo")),
    );

    const result = analyzeBitmapPrefilter(expr, tagId, "i", idx);
    expect(result).not.toBeNull();
    expect(result!.candidateIds.toArray()).toEqual([0]);
    expect(result!.resolvedColumns).toEqual(
      expect.arrayContaining(["page", "status", "tag"]),
    );
  });
});

// Inequality

describe("bitmap_query: inequality", () => {
  test("column ~= literal excludes matching rows", () => {
    const idx = makeIndex();
    addObject(idx, "item", { status: "open" });
    addObject(idx, "item", { status: "closed" });
    addObject(idx, "item", { status: "open" });

    const { tagId } = idx.getTagMeta("item");
    const expr = binOp("~=", propAccess("i", "status"), lit("open"));
    const result = analyzeBitmapPrefilter(expr, tagId, "i", idx);

    expect(result).not.toBeNull();
    expect(result!.candidateIds.toArray()).toEqual([1]);
  });

  test("inequality with unknown value returns all", () => {
    const idx = makeIndex();
    addObject(idx, "item", { status: "open" });
    addObject(idx, "item", { status: "closed" });

    const { tagId } = idx.getTagMeta("item");
    const expr = binOp("~=", propAccess("i", "status"), lit("NOPE"));
    const result = analyzeBitmapPrefilter(expr, tagId, "i", idx);

    expect(result).not.toBeNull();
    expect(result!.candidateIds.toArray()).toEqual([0, 1]);
  });
});

// OR: cannot pre-filter

describe("bitmap_query: OR is not pre-filtered", () => {
  test("OR returns null (full scan needed)", () => {
    const idx = makeIndex();
    addObject(idx, "item", { page: "P1" });
    addObject(idx, "item", { page: "P2" });

    const { tagId } = idx.getTagMeta("item");
    // i.page == "P1" or i.page == "P2"
    const expr = binOp(
      "or",
      binOp("==", propAccess("i", "page"), lit("P1")),
      binOp("==", propAccess("i", "page"), lit("P2")),
    );

    // OR at the top level -> can't safely pre-filter (would need union)
    const result = analyzeBitmapPrefilter(expr, tagId, "i", idx);
    expect(result).toBeNull();
  });
});

// Unsupported patterns return null

describe("bitmap_query: unsupported patterns", () => {
  test("range comparison returns null", () => {
    const idx = makeIndex();
    addObject(idx, "item", { page: "P1" });

    const { tagId } = idx.getTagMeta("item");
    const expr = binOp(">", propAccess("i", "page"), lit("P0"));
    expect(analyzeBitmapPrefilter(expr, tagId, "i", idx)).toBeNull();
  });

  test("column == column returns null", () => {
    const idx = makeIndex();
    addObject(idx, "item", { page: "P1", name: "P1" });

    const { tagId } = idx.getTagMeta("item");
    const expr = binOp("==", propAccess("i", "page"), propAccess("i", "name"));
    expect(analyzeBitmapPrefilter(expr, tagId, "i", idx)).toBeNull();
  });

  test("function call returns null", () => {
    const idx = makeIndex();
    addObject(idx, "item", { page: "P1" });

    const { tagId } = idx.getTagMeta("item");
    const expr: LuaExpression = {
      type: "FunctionCall",
      prefix: { type: "Variable", name: "test", ctx: {} },
      args: [],
      ctx: {},
    };
    expect(analyzeBitmapPrefilter(expr, tagId, "i", idx)).toBeNull();
  });

  test("all-unresolvable AND returns null", () => {
    const idx = makeIndex();
    addObject(idx, "item", { page: "P1" });

    const { tagId } = idx.getTagMeta("item");
    // i.page > "P0" and i.page < "P2" — neither is ==
    const expr = binOp(
      "and",
      binOp(">", propAccess("i", "page"), lit("P0")),
      binOp("<", propAccess("i", "page"), lit("P2")),
    );
    expect(analyzeBitmapPrefilter(expr, tagId, "i", idx)).toBeNull();
  });
});

// Edge cases

describe("bitmap_query: edge cases", () => {
  test("empty index returns empty bitmap", () => {
    const idx = makeIndex();
    idx.getTagMeta("item"); // register but no objects

    const { tagId } = idx.getTagMeta("item");
    const expr = binOp("==", propAccess("i", "page"), lit("P1"));
    const result = analyzeBitmapPrefilter(expr, tagId, "i", idx);

    expect(result).not.toBeNull();
    expect(result!.candidateIds.isEmpty()).toBe(true);
  });

  test("parenthesized expression is unwrapped", () => {
    const idx = makeIndex();
    addObject(idx, "item", { page: "P1" });

    const { tagId } = idx.getTagMeta("item");
    const expr = paren(binOp("==", propAccess("i", "page"), lit("P1")));
    const result = analyzeBitmapPrefilter(expr, tagId, "i", idx);

    expect(result).not.toBeNull();
    expect(result!.candidateIds.toArray()).toEqual([0]);
  });

  test("deeply nested AND chain", () => {
    const idx = makeIndex();
    addObject(idx, "item", { page: "P1", status: "open", tag: "a", name: "X" });

    const { tagId } = idx.getTagMeta("item");
    // ((page == "P1" and status == "open") and tag == "a") and name == "X"
    const expr = binOp(
      "and",
      binOp(
        "and",
        paren(
          binOp(
            "and",
            binOp("==", propAccess("i", "page"), lit("P1")),
            binOp("==", propAccess("i", "status"), lit("open")),
          ),
        ),
        binOp("==", propAccess("i", "tag"), lit("a")),
      ),
      binOp("==", propAccess("i", "name"), lit("X")),
    );

    const result = analyzeBitmapPrefilter(expr, tagId, "i", idx);
    expect(result).not.toBeNull();
    expect(result!.candidateIds.toArray()).toEqual([0]);
    expect(result!.resolvedColumns).toHaveLength(4);
  });
});
