import { expect, test } from "vitest";
import { rank, typoScore } from "./fuzzy.ts";

const pages = [
  { name: "Projects/SilverBullet", displayName: "SB" },
  { name: "Projects/Fuzzy Matching" },
  { name: "Journal/2026-08-06" },
  { name: "silver.md notes", aliases: ["shiny"] },
];

test("segment weighting", () => {
  const r = rank(pages, "silverbullet");
  expect(r[0].name).toEqual("Projects/SilverBullet");
});

test("alias matching", () => {
  const r = rank(pages, "shiny");
  expect(r.length).toEqual(1);
  expect(r[0].name).toEqual("silver.md notes");
});

test("zero-score token excludes", () => {
  expect(rank(pages, "xyzzynope").length).toEqual(0);
});

test("empty phrase returns all in orderId order", () => {
  const r = rank(pages, "", { orderId: (o) => o.name.length });
  expect(r.length).toEqual(4);
  expect(r.map((x) => x.name)).toEqual(
    [...r.map((x) => x.name)].sort((a, b) => a.length - b.length),
  );
});

test("custom fields", () => {
  const objs = [{ title: "Hello World" }, { title: "Goodbye" }];
  const r = rank(objs, "hello", { fields: { title: 1.0 } });
  expect(r.length).toEqual(1);
  expect(r[0].title).toEqual("Hello World");
});

test("an exact whole-field match wins a tie over orderId, even against a candidate whose name is a superset", () => {
  const objs = [
    { name: "Navigate: Widget Demo Picker" },
    { name: "Navigate: Widget Demo" },
  ];
  // Every token in "navigate: widget demo" matches equally well against both
  // candidates (the superset's extra "picker" word is never penalized), so
  // without the exact-match tie-break `orderId` alone would decide -- and
  // here it deliberately favors the wrong (superset) row first.
  const r = rank(objs, "navigate: widget demo", {
    orderId: (o) => (o.name === "Navigate: Widget Demo Picker" ? 0 : 1),
  });
  expect(r[0].name).toEqual("Navigate: Widget Demo");
});

test("no exact match: the tie still falls back to orderId", () => {
  const objs = [{ name: "Outline Picker" }, { name: "Outline Viewer" }];
  const r = rank(objs, "outline", {
    orderId: (o) => (o.name === "Outline Viewer" ? 0 : 1),
  });
  expect(r[0].name).toEqual("Outline Viewer");
});

// --- Equivalence proof: typoScore rewrite vs. pre-rewrite reference ---
//
// `typoScoreReference` and `boundedDamerauLevenshteinReference` below are a
// verbatim copy of the implementation that shipped before the ranker
// perf fix (fuzzy.ts, commit 65a937d7), kept only as a test oracle. The
// property test that follows asserts the new `typoScore` (imported from
// fuzzy.ts) returns the bit-identical score across thousands of randomized
// and adversarial (phrase, candidate) pairs.

function boundedDamerauLevenshteinReference(
  a: string,
  b: string,
  max: number,
): number {
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;

  let prevPrev = new Array(bl + 1);
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;

  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prevPrev[j - 2] + 1);
      }
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    const tmp = prevPrev;
    prevPrev = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[bl];
}

function typoScoreReference(token: string, candidate: string): number {
  if (token.length < 4) return 0;
  const max = Math.min(2, Math.floor(token.length / 4));
  if (max < 1) return 0;

  let bestDist = max + 1;
  for (
    let len = Math.max(1, token.length - max);
    len <= token.length + max;
    len++
  ) {
    for (let start = 0; start + len <= candidate.length; start++) {
      const slice = candidate.slice(start, start + len);
      const d = boundedDamerauLevenshteinReference(token, slice, bestDist - 1);
      if (d < bestDist) bestDist = d;
      if (bestDist === 0) break;
    }
    if (bestDist === 0) break;
  }
  if (bestDist > max) return 0;
  return 0.25 - 0.05 * bestDist;
}

// Deterministic PRNG (mulberry32) — reproducible across runs/machines.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

const REALISTIC_ALPHABET =
  "abcdefghijklmnopqrstuvwxyz0123456789/-_. :ABCDEFGHIJ".split("");
const ADVERSARIAL_ALPHABET = "aeiost".split(""); // high-frequency letters
const UNICODE_ALPHABET = [
  "é",
  "ñ",
  "ü",
  "́", // combining acute accent
  "中",
  "文",
  "😀", // surrogate pair
  "🚀",
  "a",
  "e",
];

function randomString(
  rng: () => number,
  len: number,
  alphabet: string[],
): string {
  let s = "";
  for (let i = 0; i < len; i++) s += pick(rng, alphabet);
  return s;
}

type PairShape =
  | "realistic"
  | "adversarial-repeat"
  | "adversarial-shared-affix"
  | "unicode"
  | "empty-candidate"
  | "empty-token"
  | "phrase-longer-than-candidate"
  | "identical";

function generatePair(
  rng: () => number,
  tokenLen: number,
  shape: PairShape,
): { token: string; candidate: string } {
  switch (shape) {
    case "realistic": {
      const token = randomString(rng, tokenLen, REALISTIC_ALPHABET);
      const candLen = randInt(rng, 0, tokenLen + 10);
      const candidate = randomString(rng, candLen, REALISTIC_ALPHABET);
      return { token, candidate };
    }
    case "adversarial-repeat": {
      const ch = pick(rng, ADVERSARIAL_ALPHABET);
      const token = ch.repeat(tokenLen);
      const candLen = Math.max(0, tokenLen + randInt(rng, -3, 3));
      const candidate = randomString(rng, candLen, ADVERSARIAL_ALPHABET);
      return { token, candidate };
    }
    case "adversarial-shared-affix": {
      const token = randomString(rng, tokenLen, REALISTIC_ALPHABET);
      const affixLen = Math.min(tokenLen, randInt(rng, 0, tokenLen));
      const prefix = token.slice(0, affixLen);
      const suffix = token.slice(tokenLen - affixLen);
      const middle = randomString(rng, randInt(rng, 0, 8), REALISTIC_ALPHABET);
      const candidate = rng() < 0.5 ? prefix + middle : middle + suffix;
      return { token, candidate };
    }
    case "unicode": {
      const token = randomString(rng, tokenLen, UNICODE_ALPHABET);
      const candLen = randInt(rng, 0, tokenLen + 6);
      const candidate = randomString(rng, candLen, UNICODE_ALPHABET);
      return { token, candidate };
    }
    case "empty-candidate":
      return {
        token: randomString(rng, tokenLen, REALISTIC_ALPHABET),
        candidate: "",
      };
    case "empty-token":
      return {
        token: "",
        candidate: randomString(rng, tokenLen, REALISTIC_ALPHABET),
      };
    case "phrase-longer-than-candidate": {
      const token = randomString(rng, tokenLen, REALISTIC_ALPHABET);
      const candLen = Math.max(0, randInt(rng, 0, Math.max(0, tokenLen - 3)));
      const candidate = randomString(rng, candLen, REALISTIC_ALPHABET);
      return { token, candidate };
    }
    case "identical": {
      const token = randomString(rng, tokenLen, REALISTIC_ALPHABET);
      return { token, candidate: token };
    }
  }
}

const PAIR_SHAPES: PairShape[] = [
  "realistic",
  "realistic",
  "realistic",
  "adversarial-repeat",
  "adversarial-shared-affix",
  "unicode",
  "empty-candidate",
  "empty-token",
  "phrase-longer-than-candidate",
  "identical",
];

test("typoScore matches pre-rewrite reference across thousands of randomized/adversarial pairs", () => {
  const rng = mulberry32(0xc0ffee);
  let count = 0;
  const mismatches: string[] = [];
  for (let tokenLen = 1; tokenLen <= 24; tokenLen++) {
    for (const shape of PAIR_SHAPES) {
      // A handful of samples per (length, shape) combination.
      for (let sample = 0; sample < 25; sample++) {
        const { token, candidate } = generatePair(rng, tokenLen, shape);
        const actual = typoScore(token, candidate);
        const expected = typoScoreReference(token, candidate);
        count++;
        if (actual !== expected) {
          mismatches.push(
            `token=${JSON.stringify(token)} candidate=${JSON.stringify(
              candidate,
            )} actual=${actual} expected=${expected}`,
          );
          if (mismatches.length >= 10) break;
        }
      }
      if (mismatches.length >= 10) break;
    }
    if (mismatches.length >= 10) break;
  }
  expect(count).toBeGreaterThan(2000);
  expect(mismatches).toEqual([]);
});
