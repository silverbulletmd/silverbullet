import type { StyleRecord } from "../../space_style.ts";

/**
 * `empty`: the block holds CSS, yet the browser parsed no rules from it. The
 * browser drops invalid CSS without a word, so that is almost always a syntax
 * error. (A block that is only comments is fine.) `inactive`: a block of a
 * theme that isn't the active one, so it isn't applied (or parsed) at all.
 */
export type StyleStatus = "applied" | "empty" | "inactive";

const COMMENTS = /\/\*[\s\S]*?\*\//g;

export function styleStatus(r: StyleRecord): StyleStatus {
  if (!r.active) return "inactive";
  return r.rules === 0 && r.source.replace(COMMENTS, "").trim() !== ""
    ? "empty"
    : "applied";
}
