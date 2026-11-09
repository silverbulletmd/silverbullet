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

/**
 * The row named exactly `phrase` when the active segment filters it out, and
 * the segment it lives in instead. Typing a name you know exists ("Library/Config", a
 * meta page, while on Pages) would otherwise show nothing at all -- and offer
 * no create either, since the name is taken.
 *
 * `admits` applies every filter other than the segment (dropdown, hashtags),
 * so only the segment is overruled. The segment named is the first `where`
 * segment admitting the row, else the first pass-through one (a hidden page
 * only "All" shows).
 */
export function exactMatchElsewhere(
  rows: Row[],
  phrase: string,
  index: number,
  segments: SegmentMeta[] | undefined,
  masks: SegmentMasks | undefined,
  admits: (row: Row) => boolean = () => true,
): { row: Row; segment: string } | undefined {
  const active = segments?.[index];
  if (!segments || !phrase || !active?.hasWhere || !masks) return undefined;
  const row = rows.find((r) => r.primary === phrase);
  if (!row || masks.get(row)?.[index] === true || !admits(row)) {
    return undefined;
  }
  const mask = masks.get(row);
  const home =
    segments.find((s, i) => s.hasWhere && mask?.[i] === true) ??
    segments.find((s) => !s.hasWhere);
  return home ? { row, segment: home.label } : undefined;
}
