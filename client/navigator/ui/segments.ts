import type { Row, SegmentMeta } from "../types.ts";

/** Per-row `where` results, parallel to `meta.segments`. */
export type SegmentMasks = WeakMap<Row, boolean[]>;

/** The segment a view starts on: the `default = true` one, else the first. */
export function defaultSegmentIndex(segments?: SegmentMeta[]): number {
  if (!segments?.length) return 0;
  const index = segments.findIndex((s) => s.default === true);
  return index === -1 ? 0 : index;
}

/** The segment a persisted label names, or -1 when it names none. */
export function segmentIndexFor(
  segments: SegmentMeta[] | undefined,
  label: unknown,
): number {
  if (!segments?.length || typeof label !== "string") return -1;
  return segments.findIndex((s) => s.label === label);
}

export function cycleSegmentIndex(
  current: number,
  count: number,
  delta: number,
): number {
  if (count <= 0) return 0;
  return (((current + delta) % count) + count) % count;
}

/**
 * The rows the active segment admits. A segment without a `where` is a
 * pass-through; one with a `where` that produced no mask (a failed batch, an
 * object added since the last load) drops the row -- the same fail-closed rule
 * action `when` masks follow.
 */
export function applySegment(
  rows: Row[],
  index: number,
  segments?: SegmentMeta[],
  masks?: SegmentMasks,
): Row[] {
  const active = segments?.[index];
  if (!active?.hasWhere) return rows;
  if (!masks) return [];
  return rows.filter((row) => masks.get(row)?.[index] === true);
}
