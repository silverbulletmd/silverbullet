import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";
import { fileName } from "@silverbulletmd/silverbullet/lib/resolve";

function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function tokenize(query: string): string[] {
  return normalize(query).split(/\s+/).filter((t) => t.length > 0);
}

const WORD_BOUNDARY_CHARS = new Set(["/", "-", "_", " ", ".", ":"]);

function isWordBoundaryAt(
  original: string,
  lowered: string,
  i: number,
): boolean {
  if (i === 0) return true;
  const prev = lowered[i - 1];
  if (WORD_BOUNDARY_CHARS.has(prev)) return true;
  // CamelCase boundary: previous original char is lowercase, current is uppercase
  const origPrev = original[i - 1];
  const origCur = original[i];
  if (
    origPrev && origCur &&
    origPrev === origPrev.toLowerCase() &&
    origPrev !== origPrev.toUpperCase() &&
    origCur === origCur.toUpperCase() &&
    origCur !== origCur.toLowerCase()
  ) {
    return true;
  }
  return false;
}

function boundedDamerauLevenshtein(
  a: string,
  b: string,
  max: number,
): number {
  // Returns edit distance if <= max, otherwise max + 1.
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;

  // Three-row DP with early-exit per row, rotating row references each iteration.
  let prevPrev = new Array(bl + 1);
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;

  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
      // Damerau transposition
      if (
        i > 1 && j > 1 &&
        a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]
      ) {
        v = Math.min(v, prevPrev[j - 2] + 1);
      }
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    // Rotate: prevPrev <- prev, prev <- curr, curr <- old prevPrev (reused as scratch)
    const tmp = prevPrev;
    prevPrev = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[bl];
}

function typoScore(token: string, candidate: string): number {
  if (token.length < 4) return 0;
  const max = Math.min(2, Math.floor(token.length / 4));
  if (max < 1) return 0;

  // Try aligning token against each substring of candidate of length token.length +/- max.
  let bestDist = max + 1;
  for (
    let len = Math.max(1, token.length - max);
    len <= token.length + max;
    len++
  ) {
    for (let start = 0; start + len <= candidate.length; start++) {
      const slice = candidate.slice(start, start + len);
      const d = boundedDamerauLevenshtein(token, slice, bestDist - 1);
      if (d < bestDist) bestDist = d;
      if (bestDist === 0) break;
    }
    if (bestDist === 0) break;
  }
  if (bestDist > max) return 0;
  return 0.25 - 0.05 * bestDist; // 0.25 / 0.20 / 0.15
}

function subsequenceScore(
  token: string,
  candidate: string,
  candidateOriginal: string,
): number {
  // Greedy left-to-right match; track contiguous runs and word-boundary hits.
  let ti = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  let contiguousRunSum = 0;
  let currentRun = 0;
  let boundaryHits = 0;
  let prevMatchCi = -2;

  for (let ci = 0; ci < candidate.length && ti < token.length; ci++) {
    if (candidate[ci] === token[ti]) {
      if (firstMatch < 0) firstMatch = ci;
      lastMatch = ci;
      if (isWordBoundaryAt(candidateOriginal, candidate, ci)) boundaryHits++;
      if (ci === prevMatchCi + 1) {
        currentRun++;
      } else {
        contiguousRunSum += currentRun * currentRun;
        currentRun = 1;
      }
      prevMatchCi = ci;
      ti++;
    }
  }
  contiguousRunSum += currentRun * currentRun;

  if (ti < token.length) return 0; // not a subsequence at all

  // Normalize: token length over span (penalizes wide spans)
  const span = lastMatch - firstMatch + 1;
  const density = token.length / span; // in (0, 1]
  const boundaryBonus = boundaryHits / token.length; // in [0, 1]
  const contiguityBonus = contiguousRunSum / (token.length * token.length); // in (0, 1]

  // Weighted combination scaled into [0.30, 0.65]
  const raw = 0.5 * density + 0.3 * contiguityBonus + 0.2 * boundaryBonus;
  return 0.30 + raw * 0.35;
}

export function scoreToken(token: string, candidate: string): number {
  if (!token) return 0;
  const t = normalize(token);
  const cOrig = candidate;
  const c = normalize(candidate);

  // Tier 1: exact equality
  if (c === t) return 1.0;

  // Tier 2: prefix
  if (c.startsWith(t)) {
    return isWordBoundaryAt(cOrig, c, 0) ? 0.95 : 0.9;
  }

  // Tier 3: substring. Search for the best occurrence — a word-boundary
  // match wins even if it appears later than a non-boundary match.
  {
    let bestIdx = -1;
    let bestBoundary = false;
    let idx = c.indexOf(t);
    while (idx >= 0) {
      const boundary = isWordBoundaryAt(cOrig, c, idx);
      if (bestIdx < 0 || (boundary && !bestBoundary)) {
        bestIdx = idx;
        bestBoundary = boundary;
        if (boundary) break; // can't get better
      }
      idx = c.indexOf(t, idx + 1);
    }
    if (bestIdx >= 0) {
      // For very short tokens (<=2 chars), only count substring matches at
      // word boundaries — otherwise short tokens generate too much noise.
      if (t.length > 2 || bestBoundary) {
        return bestBoundary ? 0.80 : 0.75;
      }
      // fall through for short non-boundary substring matches
    }
  }

  // Tier 4: subsequence (short tokens skip this tier; substring at boundary
  // is the only way for them to match)
  if (t.length > 2) {
    const subseq = subsequenceScore(t, c, cOrig);
    if (subseq > 0) return subseq;
  }

  // Tier 5: bounded typo
  const typo = typoScore(t, c);
  if (typo > 0) return typo;

  return 0;
}

type Field = { value: string; weight: number };

function fieldsOf(opt: FilterOption): Field[] {
  const fields: Field[] = [];
  const name = opt.name ?? "";
  fields.push({ value: name, weight: 0.85 });
  const base = fileName(name);
  if (base) fields.push({ value: base, weight: 1.0 });
  const displayName = opt.meta?.displayName;
  if (displayName) fields.push({ value: displayName, weight: 0.9 });
  const aliases = opt.meta?.aliases;
  if (aliases && aliases.length > 0) {
    fields.push({ value: aliases.join(" "), weight: 0.85 });
  }
  return fields;
}

export function scoreCandidate(
  query: string,
  option: FilterOption,
): number | null {
  const tokens = tokenize(query);
  if (tokens.length === 0) return 0;
  const fields = fieldsOf(option);
  if (fields.length === 0) return null;

  const perTokenBest: number[] = [];
  for (const token of tokens) {
    let best = 0;
    for (const f of fields) {
      const raw = scoreToken(token, f.value);
      const weighted = raw * f.weight;
      if (weighted > best) best = weighted;
    }
    if (best === 0) return null; // any token fails ⇒ candidate excluded
    perTokenBest.push(best);
  }
  // Geometric mean
  let logSum = 0;
  for (const s of perTokenBest) logSum += Math.log(s);
  return Math.exp(logSum / perTokenBest.length);
}

function compareOrderId(
  a: number | undefined,
  b: number | undefined,
): number {
  const aOrder = a ?? 0;
  const bOrder = b ?? 0;
  if (aOrder === Infinity && bOrder === Infinity) return 0;
  if (aOrder === Infinity) return 1;
  if (bOrder === Infinity) return -1;
  return aOrder - bOrder;
}

type Scored = { item: FilterOption; score: number };

export function fuzzySearchAndSort(
  arr: FilterOption[],
  query: string,
): FilterOption[] {
  if (!query || query.trim() === "") {
    return [...arr].sort((a, b) => compareOrderId(a.orderId, b.orderId));
  }
  const scored: Scored[] = [];
  for (const item of arr) {
    const s = scoreCandidate(query, item);
    if (s !== null && s > 0) scored.push({ item, score: s });
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const orderCmp = compareOrderId(a.item.orderId, b.item.orderId);
    if (orderCmp !== 0) return orderCmp;
    const lenCmp = (a.item.name?.length ?? 0) - (b.item.name?.length ?? 0);
    if (lenCmp !== 0) return lenCmp;
    return (a.item.name ?? "").localeCompare(b.item.name ?? "");
  });
  return scored.map((s) => ({ ...s.item, score: s.score }));
}
