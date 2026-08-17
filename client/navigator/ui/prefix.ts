/**
 * Prefix routing: what the first character typed into an empty phrase means.
 *
 * Two mechanisms share the gesture, and the difference is what they reach:
 *
 * * a **segment prefix** (`segments[i].prefix`) narrows the view to a subset of
 *   the rows it already has -- no new data, no new configuration;
 * * a **prefix view** (`prefixViews[char]`) replaces the view with a different
 *   one in the same slot -- its own source, its own presentation, its own
 *   everything.
 *
 * Both strip the character from the phrase and carry whatever followed it.
 * `navigator.define` guarantees the two namespaces don't overlap, so the order
 * resolved here is a formality rather than a precedence rule.
 */

import type { SegmentMeta, ViewMeta } from "../types.ts";

export type PrefixTarget =
  | { kind: "segment"; index: number; rest: string }
  | { kind: "view"; view: string; rest: string };

/**
 * What a phrase typed from empty routes to, if anything.
 *
 * @param previous the phrase before this edit -- routing only ever triggers on
 * the *first* character, so that a `$` later in a phrase is just a `$`.
 */
export function resolvePrefix(
  meta: ViewMeta | undefined,
  previous: string,
  next: string,
): PrefixTarget | undefined {
  if (!meta || previous !== "" || next === "") return undefined;
  // Code point, not code unit: a prefix could be an emoji, and slicing one in
  // half would leave a lone surrogate in the phrase.
  const char = [...next][0]!;
  const rest = next.slice(char.length);
  const index = segmentFor(meta.segments, char);
  if (index >= 0) return { kind: "segment", index, rest };
  const view = meta.prefixViews?.[char];
  if (typeof view === "string" && view) return { kind: "view", view, rest };
  return undefined;
}

/** The segment a character activates, or -1. */
export function segmentFor(
  segments: SegmentMeta[] | undefined,
  char: string,
): number {
  if (!segments?.length) return -1;
  return segments.findIndex((s) => s.prefix === char);
}
