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

/**
 * How many rows the preview reads first when they don't need every object (no
 * sort or grouping): one more than it shows, to tell whether there are more
 */
export const LEADING_ROWS = PREVIEW_ROWS + 1;

export type PreviewCounts = {
  /** Rows the query returns, after its limit; null until counted */
  count: number | null;
  /** Objects the query matches, before its limit; null until counted */
  matched: number | null;
};

/** The counts of a whole result, `all` taken before the query's limit */
export function fullCounts(all: unknown, limit: number | null): PreviewCounts {
  const matched = rowCount(all);
  return {
    matched,
    count: limit === null ? matched : Math.min(limit, matched),
  };
}

/** The counts the leading rows tell: exact when there were no more */
export function leadingCounts(
  rows: unknown,
  limit: number | null,
): PreviewCounts {
  const n = rowCount(rows);
  if (n < LEADING_ROWS) return fullCounts(rows, limit);
  // A limit the leading rows reach is known to cut the rows off
  return { matched: null, count: limit !== null && limit < n ? limit : null };
}

export function resultsHeading(c: PreviewCounts, grouped: boolean): string {
  if (c.count === null) return `${PREVIEW_ROWS}+ results`;
  if (grouped) return `${c.count} group${c.count === 1 ? "" : "s"}`;
  if (c.matched === null) return `${c.count} of ${PREVIEW_ROWS}+ results`;
  return c.count === c.matched
    ? `${c.count} result${c.count === 1 ? "" : "s"}`
    : `${c.count} of ${c.matched} results`;
}
