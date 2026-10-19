import { describe, expect, test } from "vitest";
import { LuaTable } from "../space_lua/runtime.ts";
import {
  firstRows,
  fullCounts,
  LEADING_ROWS,
  leadingCounts,
  PREVIEW_ROWS,
  previewDelay,
  previewSlice,
  resultsHeading,
  rowCount,
} from "./query_preview.ts";

describe("previewSlice", () => {
  test("cuts a long array to the first 200 rows", () => {
    const rows = Array.from({ length: 450 }, (_, i) => ({ n: i }));
    const s = previewSlice(rows);
    expect(PREVIEW_ROWS).toBe(200);
    expect(s.shown).toBe(200);
    expect(s.total).toBe(450);
    expect(s.value).toHaveLength(200);
    expect((s.value as any[])[199]).toEqual({ n: 199 });
  });

  test("cuts a long Lua array the same way", () => {
    const rows = new LuaTable(Array.from({ length: 300 }, (_, i) => i));
    const s = previewSlice(rows);
    expect(s.shown).toBe(200);
    expect(s.total).toBe(300);
    expect(s.value).toBeInstanceOf(LuaTable);
    expect((s.value as LuaTable).length).toBe(200);
  });

  test("short results and single values pass through", () => {
    const short = [1, 2, 3];
    expect(previewSlice(short)).toEqual({ value: short, shown: 3, total: 3 });
    expect(previewSlice("x")).toEqual({ value: "x", shown: 1, total: 1 });
  });
});

describe("firstRows and rowCount", () => {
  test("cut arrays and Lua arrays alike, leave single values", () => {
    expect(firstRows([1, 2, 3], 2)).toEqual([1, 2]);
    const lua = firstRows(new LuaTable([1, 2, 3]), 2) as LuaTable;
    expect(lua.length).toBe(2);
    expect(firstRows("x", 0)).toBe("x");
    expect(rowCount(new LuaTable([1, 2, 3]))).toBe(3);
    expect(rowCount(null)).toBe(0);
    expect(rowCount("x")).toBe(1);
  });
});

describe("previewDelay", () => {
  test("a change after a quiet spell runs at once", () => {
    expect(previewDelay(10_000, 0)).toBe(0);
    expect(previewDelay(1000, 700)).toBe(0);
  });

  test("changes in quick succession wait out the rest of the window", () => {
    expect(previewDelay(1100, 1000)).toBe(150);
    expect(previewDelay(1000, 1000)).toBe(250);
  });
});

describe("preview counts", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

  test("leading rows short of the cap are the whole result", () => {
    expect(leadingCounts(rows(42), null)).toEqual({ count: 42, matched: 42 });
    expect(leadingCounts(rows(42), 10)).toEqual({ count: 10, matched: 42 });
  });

  test("a full set of leading rows leaves the total open", () => {
    expect(leadingCounts(rows(LEADING_ROWS), null)).toEqual({
      count: null,
      matched: null,
    });
    // A limit within the leading rows is reached either way
    expect(leadingCounts(rows(LEADING_ROWS), 5)).toEqual({
      count: 5,
      matched: null,
    });
    expect(leadingCounts(rows(LEADING_ROWS), 500)).toEqual({
      count: null,
      matched: null,
    });
  });

  test("a whole result counts before and after the limit", () => {
    expect(fullCounts(rows(900), null)).toEqual({ count: 900, matched: 900 });
    expect(fullCounts(rows(900), 500)).toEqual({ count: 500, matched: 900 });
  });

  test("the heading says what is known so far", () => {
    const h = (count: number | null, matched: number | null, grouped = false) =>
      resultsHeading({ count, matched }, grouped);
    expect(h(null, null)).toBe(`${PREVIEW_ROWS}+ results`);
    expect(h(5, null)).toBe(`5 of ${PREVIEW_ROWS}+ results`);
    expect(h(5, 900)).toBe("5 of 900 results");
    expect(h(1, 1)).toBe("1 result");
    expect(h(3, 3, true)).toBe("3 groups");
  });
});
