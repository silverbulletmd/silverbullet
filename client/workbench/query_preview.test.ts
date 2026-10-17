import { describe, expect, test } from "vitest";
import { LuaTable } from "../space_lua/runtime.ts";
import {
  firstRows,
  previewDelay,
  PREVIEW_ROWS,
  previewSlice,
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
