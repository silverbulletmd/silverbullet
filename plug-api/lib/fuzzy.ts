function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
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
    origPrev &&
    origCur &&
    origPrev === origPrev.toLowerCase() &&
    origPrev !== origPrev.toUpperCase() &&
    origCur === origCur.toUpperCase() &&
    origCur !== origCur.toLowerCase()
  ) {
    return true;
  }
  return false;
}

function bestSubstringEditDistance(token: string, candidate: string): number {
  const tl = token.length;
  const cl = candidate.length;
  let prevPrev = new Array(cl + 1).fill(0);
  let prev = new Array(cl + 1).fill(0);
  let curr = new Array(cl + 1);

  for (let i = 1; i <= tl; i++) {
    curr[0] = i;
    for (let j = 1; j <= cl; j++) {
      const cost = token[i - 1] === candidate[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (
        i > 1 &&
        j > 1 &&
        token[i - 1] === candidate[j - 2] &&
        token[i - 2] === candidate[j - 1]
      ) {
        v = Math.min(v, prevPrev[j - 2] + 1);
      }
      curr[j] = v;
    }
    const tmp = prevPrev;
    prevPrev = prev;
    prev = curr;
    curr = tmp;
  }

  let best = prev[0];
  for (let j = 1; j <= cl; j++) {
    if (prev[j] < best) best = prev[j];
  }
  return best;
}

export function typoScore(token: string, candidate: string): number {
  if (token.length < 4) return 0;
  const max = Math.min(2, Math.floor(token.length / 4));
  if (max < 1) return 0;

  const bestDist = bestSubstringEditDistance(token, candidate);
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
  return 0.3 + raw * 0.35;
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
        return bestBoundary ? 0.8 : 0.75;
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

export type RankField = { weight: number; segments?: boolean };
export type RankOptions<T> = {
  fields?: Record<string, number | RankField>;
  orderId?: (obj: T) => number;
};

const DEFAULT_FIELDS: Record<string, number | RankField> = {
  name: { weight: 1.0, segments: true },
  displayName: 0.9,
  aliases: 0.85,
};

export function rank<T extends Record<string, any>>(
  objects: T[],
  phrase: string,
  options: RankOptions<T> = {},
): (T & { score: number })[] {
  const fields = options.fields ?? DEFAULT_FIELDS;
  const orderId = options.orderId ?? (() => 0);
  const tokens = normalize(phrase)
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return [...objects]
      .sort(
        (a, b) =>
          orderId(a) - orderId(b) ||
          String(a.name ?? "").localeCompare(String(b.name ?? "")),
      )
      .map((o) => ({ ...o, score: 1 }));
  }
  const results: (T & { score: number })[] = [];
  for (const obj of objects) {
    let product = 1;
    let excluded = false;
    for (const token of tokens) {
      let best = 0;
      for (const [fieldName, fieldSpec] of Object.entries(fields)) {
        const spec: RankField =
          typeof fieldSpec === "number" ? { weight: fieldSpec } : fieldSpec;
        const raw = obj[fieldName];
        const values: string[] = Array.isArray(raw)
          ? raw.map(String)
          : raw != null
            ? [String(raw)]
            : [];
        for (const value of values) {
          if (spec.segments && value.includes("/")) {
            const last = value.slice(value.lastIndexOf("/") + 1);
            best = Math.max(
              best,
              scoreToken(token, last) * spec.weight,
              scoreToken(token, value) * spec.weight * 0.85,
            );
          } else {
            best = Math.max(best, scoreToken(token, value) * spec.weight);
          }
        }
      }
      if (best === 0) {
        excluded = true;
        break;
      }
      product *= best;
    }
    if (!excluded) {
      results.push({ ...obj, score: product ** (1 / tokens.length) });
    }
  }
  return results.sort(
    (a, b) =>
      b.score - a.score ||
      orderId(a) - orderId(b) ||
      String(a.name ?? "").localeCompare(String(b.name ?? "")),
  );
}
