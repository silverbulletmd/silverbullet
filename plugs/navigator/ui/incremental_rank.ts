import type { RankedRow } from "./engine.ts";
import type { Row } from "./types.ts";

function normalizePhrase(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function tokenize(normalized: string): string[] {
  return normalized.split(/\s+/).filter((t) => t.length > 0);
}

// Mirrors plug-api/lib/fuzzy.ts's scoreToken tier gates: below length 3,
// only prefix/boundary-substring tiers apply; length 3 additionally opens
// non-boundary substring + subsequence; length 4 turns on the typo tier
// (max=1); length 8 loosens it to max=2 (and it stays there for any longer
// token). A token whose length crosses one of these boundaries can gain a
// match it didn't have one character shorter -- see
// task-ranker-perf-phase2-report.md for the derivation.
function tierBracket(len: number): 0 | 1 | 2 | 3 {
  if (len <= 2) return 0;
  if (len === 3) return 1;
  if (len <= 7) return 2;
  return 3;
}

function sameBracket(len0: number, len1: number): boolean {
  return tierBracket(len0) === tierBracket(len1);
}

/**
 * Whether `newPhrase`'s ranked-match set is guaranteed to be a subset of
 * `oldPhrase`'s -- i.e. whether it's safe to rank `newPhrase` against only
 * the rows that already matched `oldPhrase` instead of the full row set.
 */
export function isSafeIncrementalAppend(
  oldPhrase: string,
  newPhrase: string,
): boolean {
  const oldNorm = normalizePhrase(oldPhrase);
  const newNorm = normalizePhrase(newPhrase);
  if (newNorm.length <= oldNorm.length || !newNorm.startsWith(oldNorm)) {
    return false;
  }
  const oldTokens = tokenize(oldNorm);
  const newTokens = tokenize(newNorm);
  // An empty phrase ranks through rank()'s separate "everything matches"
  // branch, not the per-token product -- not a case this subset argument
  // covers.
  if (oldTokens.length === 0 || newTokens.length < oldTokens.length) {
    return false;
  }
  for (let i = 0; i < oldTokens.length - 1; i++) {
    if (oldTokens[i] !== newTokens[i]) return false;
  }
  const oldLast = oldTokens[oldTokens.length - 1];
  const newAtSlot = newTokens[oldTokens.length - 1];
  if (oldLast === newAtSlot) return true;
  // Any tokens past this slot in newTokens are brand new (typing past a
  // space) -- always safe, since a phrase with an extra required token can
  // only match a subset of what it matched without that token.
  return newAtSlot.startsWith(oldLast) && sameBracket(oldLast.length, newAtSlot.length);
}

export type RankCacheEntry = {
  view: unknown;
  filteredRows: Row[];
  rankPhrase: string;
  ranked: RankedRow[];
};

/**
 * Ranks `rankPhrase` against `filteredRows`, reusing `cache`'s matched rows
 * as the candidate set instead of all of `filteredRows` when
 * `isSafeIncrementalAppend` clears it. The candidate subset is built by
 * filtering `filteredRows` (not by reusing `cache.ranked`'s order) so the
 * rows keep their original relative order -- `rank()`'s tie-break sorts by
 * position in the array it's given, and re-ranking in score order would
 * silently change tie-break results between rows that score equally.
 */
export function rankIncrementally(
  cache: RankCacheEntry | undefined,
  view: unknown,
  filteredRows: Row[],
  rankPhrase: string,
  rankFn: (rows: Row[], phrase: string) => RankedRow[],
): { ranked: RankedRow[]; next: RankCacheEntry } {
  let candidateRows = filteredRows;
  if (
    cache !== undefined &&
    cache.view === view &&
    cache.filteredRows === filteredRows &&
    isSafeIncrementalAppend(cache.rankPhrase, rankPhrase)
  ) {
    const matched = new Set(cache.ranked.map((r) => r.row));
    candidateRows = filteredRows.filter((row) => matched.has(row));
  }
  const ranked = rankFn(candidateRows, rankPhrase);
  return { ranked, next: { view, filteredRows, rankPhrase, ranked } };
}
