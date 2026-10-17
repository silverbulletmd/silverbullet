import { LuaTable } from "../space_lua/runtime.ts";

/** The preview renders at most this many rows; the exported query is unchanged */
export const PREVIEW_ROWS = 200;

/** The shortest gap between two runs of the preview's query */
export const PREVIEW_GAP_MS = 250;

/**
 * How long to wait before running the preview's query, given when it last
 * ran: at once after a quiet spell (a click), else the rest of the gap, so
 * typing doesn't run it on every keystroke
 */
export function previewDelay(now: number, lastRun: number): number {
  return Math.max(0, PREVIEW_GAP_MS - (now - lastRun));
}

/** How many rows a result has: a single value counts as one */
export function rowCount(value: unknown): number {
  if (Array.isArray(value) || value instanceof LuaTable) return value.length;
  return value === null || value === undefined ? 0 : 1;
}

/** A result's first `n` rows, in its own kind of array; a single value as is */
export function firstRows(value: unknown, n: number): unknown {
  if (Array.isArray(value)) {
    return value.length > n ? value.slice(0, n) : value;
  }
  if (value instanceof LuaTable && value.length > n) {
    const rows = [];
    for (let i = 1; i <= n; i++) rows.push(value.rawGet(i));
    return new LuaTable(rows);
  }
  return value;
}

export function previewSlice(value: unknown): {
  value: unknown;
  shown: number;
  total: number;
} {
  const isRows =
    Array.isArray(value) || (value instanceof LuaTable && value.length > 0);
  if (!isRows) return { value, shown: 1, total: 1 };
  const total = rowCount(value);
  return {
    value: firstRows(value, PREVIEW_ROWS),
    shown: Math.min(total, PREVIEW_ROWS),
    total,
  };
}
