import { expect, test } from "vitest";
import { rank } from "../../../plug-api/lib/fuzzy.ts";
import {
  isSafeIncrementalAppend,
  type RankCacheEntry,
  rankIncrementally,
} from "./incremental_rank.ts";
import type { RankedRow } from "./engine.ts";
import type { Row } from "./types.ts";

// --- isSafeIncrementalAppend: the tier-bracket boundaries themselves ---

test("safe: append within the same tier bracket", () => {
  // 1->2, 4->5..6->7 (max=1 throughout), 8->9..8->20 (max=2 throughout).
  expect(isSafeIncrementalAppend("a", "ab")).toBe(true);
  expect(isSafeIncrementalAppend("abcd", "abcde")).toBe(true);
  expect(isSafeIncrementalAppend("abcd", "abcdefg")).toBe(true);
  expect(isSafeIncrementalAppend("abcdefgh", "abcdefghi")).toBe(true);
  expect(
    isSafeIncrementalAppend("abcdefgh", "abcdefghijklmnopqrst"),
  ).toBe(true);
});

test("unsafe: append crosses a tier gate (2->3, 3->4, 7->8)", () => {
  expect(isSafeIncrementalAppend("ab", "abc")).toBe(false);
  expect(isSafeIncrementalAppend("abc", "abcd")).toBe(false);
  expect(isSafeIncrementalAppend("abcdefg", "abcdefgh")).toBe(false);
});

test("safe: starting a brand new token (space typed)", () => {
  // A new AND-condition on the score product can only shrink the match set,
  // whatever length the new token grows to -- including across its own
  // tier gates, since it started at length 0 this transition.
  expect(isSafeIncrementalAppend("abcd", "abcd e")).toBe(true);
  expect(isSafeIncrementalAppend("abcd ", "abcd e")).toBe(true);
  expect(isSafeIncrementalAppend("abcd", "abcd etaonrishdlucmfyw")).toBe(
    true,
  );
});

test("unsafe: backspace (phrase shrinks)", () => {
  expect(isSafeIncrementalAppend("abcde", "abcd")).toBe(false);
  expect(isSafeIncrementalAppend("abc def", "abc de")).toBe(false);
});

test("unsafe: mid-string edit / paste-replace (not a suffix append)", () => {
  expect(isSafeIncrementalAppend("abcd", "abce")).toBe(false);
  expect(isSafeIncrementalAppend("abcd", "xyzabcd")).toBe(false);
  expect(isSafeIncrementalAppend("abc def", "abc xef")).toBe(false);
});

test("unsafe: starting from an empty phrase", () => {
  expect(isSafeIncrementalAppend("", "a")).toBe(false);
});

test("unsafe: unchanged or shorter phrase", () => {
  expect(isSafeIncrementalAppend("abcd", "abcd")).toBe(false);
});

// --- rankIncrementally: byte-identical to full ranking ---

const FIELDS = { primary: { weight: 1.0, segments: true }, description: 0.5 };

function makeRow(primary: string, description?: string): Row {
  return { obj: {}, primary, description };
}

function fullRankFn(rows: Row[], phrase: string): RankedRow[] {
  const indexed = rows.map((row, i) => ({
    primary: row.primary,
    description: row.description,
    __row: row,
    __idx: i,
  }));
  return rank(indexed, phrase, { fields: FIELDS, orderId: (o) => o.__idx }).map(
    (o) => ({ row: o.__row, score: o.score }),
  );
}

function summarize(ranked: RankedRow[]): { name: string; score: number }[] {
  return ranked.map((r) => ({ name: r.row.primary, score: r.score }));
}

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

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

const WORDS = [
  "Meeting",
  "Notes",
  "Weekly",
  "Review",
  "Projects",
  "SilverBullet",
  "Journal",
  "Draft",
  "Retrospective",
  "Planning",
  "Budget",
  "Roadmap",
  "Archive",
  "Personal",
  "Recipes",
  "Travel",
];
const ADVERSARIAL_ALPHABET = "etaonrishdlucmfywgpbvkjxqz".split("");

// 2-edit near-misses of tokens the tests below actually type through the
// 7->8 length boundary (verified against the real `scoreToken`:
// `scoreToken(token.slice(0,7), row) === 0` but
// `scoreToken(token.slice(0,8), row) > 0` for the matching token below). Only
// the widened max=2 typo tier that turns on at length 8 can reach these, so
// they're what makes a wrong tier-bracket line show up as a wrong *ranked
// row set* instead of surviving unnoticed in a corpus that only tiers 1-4
// (or a merely-absent phrase) ever touch.
const NEAR_MISS_ROWS = [
  "Plarmning", // near-miss of "planning"
  "Item-detrfspe-x", // near-miss of "retrospe" (retrospectiveplanningdocument's 8-char prefix)
  "Item-dbcdffgh-x", // near-miss of "abcdefgh" (the property test's deterministic run below)
];

function buildCorpus(rng: () => number, n: number): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const depth = 1 + Math.floor(rng() * 3);
    const segs: string[] = [];
    for (let d = 0; d < depth; d++) segs.push(pick(rng, WORDS));
    // A duplicate-tail tag so plenty of rows genuinely tie in score --
    // the tie-break (orderId) is exactly what the ordering fix protects.
    segs.push(`Item ${i % 20}`);
    rows.push(makeRow(segs.join("/"), i % 5 === 0 ? "shared description" : undefined));
  }
  for (let i = 0; i < Math.floor(n * 0.05); i++) {
    let s = "";
    for (let j = 0; j < 6 + Math.floor(rng() * 14); j++) {
      s += pick(rng, ADVERSARIAL_ALPHABET);
    }
    rows.push(makeRow(s));
  }
  for (const nearMiss of NEAR_MISS_ROWS) rows.push(makeRow(nearMiss));
  return rows;
}

/**
 * Drives `rankIncrementally` through a sequence of phrases (each one what
 * the input holds after one keystroke), asserting its output matches a
 * from-scratch full rank at every single step.
 */
function assertMatchesFullRankAtEveryStep(
  rows: Row[],
  phrases: string[],
  view: unknown = {},
) {
  let cache: RankCacheEntry | undefined;
  for (const phrase of phrases) {
    const { ranked, next } = rankIncrementally(
      cache,
      view,
      rows,
      phrase,
      fullRankFn,
    );
    cache = next;
    const expected = summarize(fullRankFn(rows, phrase));
    expect(summarize(ranked), `mismatch at phrase ${JSON.stringify(phrase)}`)
      .toEqual(expected);
  }
}

test("incremental ranking matches full ranking while typing a phrase one keystroke at a time", () => {
  const rng = mulberry32(1);
  const rows = buildCorpus(rng, 400);
  // Grows past every tier gate: 2->3, 3->4, 7->8.
  const target = "retrospectiveplanningdocument";
  const phrases = Array.from({ length: target.length }, (_, i) =>
    target.slice(0, i + 1),
  );
  assertMatchesFullRankAtEveryStep(rows, phrases);
});

test("incremental ranking matches full ranking across space-separated tokens", () => {
  const rng = mulberry32(2);
  const rows = buildCorpus(rng, 400);
  const phrases = [
    "m",
    "me",
    "mee",
    "meet",
    "meeting",
    "meeting ",
    "meeting n",
    "meeting no",
    "meeting note",
    "meeting notes",
    "meeting notes i",
    "meeting notes it",
    "meeting notes item",
  ];
  assertMatchesFullRankAtEveryStep(rows, phrases);
});

test("incremental ranking matches full ranking through a backspace", () => {
  const rng = mulberry32(3);
  const rows = buildCorpus(rng, 400);
  const phrases = [
    "p",
    "pl",
    "pla",
    "plan",
    "plann", // still grows
    "plan", // backspace past a tier-4 gate: must fall back, not just shrink
    "plann",
    "planni",
    "plannin",
    "planning", // crosses the 7->8 gate right here
    "plannin", // backspace again
    "planning",
  ];
  assertMatchesFullRankAtEveryStep(rows, phrases);
});

test("incremental ranking matches full ranking with a mid-string paste replacing the phrase", () => {
  const rng = mulberry32(4);
  const rows = buildCorpus(rng, 400);
  const phrases = ["journal", "budget roadmap", "sb"];
  assertMatchesFullRankAtEveryStep(rows, phrases);
});

test("incremental ranking matches full ranking with hashtag-shaped tokens", () => {
  const rng = mulberry32(5);
  const rows = buildCorpus(rng, 400);
  for (const row of rows.slice(0, 20)) {
    row.description = "#project #urgent";
  }
  const phrases = ["#", "#p", "#pr", "#pro", "#proj", "#proje", "#project"];
  assertMatchesFullRankAtEveryStep(rows, phrases);
});

test("property: many random typing sequences (append + backspace) always match full ranking", () => {
  const rng = mulberry32(0xf00d);
  const rows = buildCorpus(rng, 250);
  const alphabet = "abcdefghijklmnop ".split("");
  for (let trial = 0; trial < 40; trial++) {
    let phrase = "";
    const steps: string[] = [];
    const stepCount = 10 + Math.floor(rng() * 15);
    for (let i = 0; i < stepCount; i++) {
      if (phrase.length > 0 && rng() < 0.25) {
        phrase = phrase.slice(0, -1); // backspace
      } else {
        phrase += pick(rng, alphabet);
      }
      steps.push(phrase);
    }
    assertMatchesFullRankAtEveryStep(rows, steps, { trial });
  }
  // The random walk above types over a 16-letter+space alphabet and virtually
  // never spells out an 8+-char run that lands a typo-tier match -- so it
  // exercises the append/backspace machinery but not tier 5 at the 7->8
  // boundary. This deterministic run does: "abcdefgh" only matches
  // NEAR_MISS_ROWS's "Item-dbcdffgh-x" from length 8 onward (see buildCorpus).
  const target = "abcdefgh";
  const steps = Array.from({ length: target.length }, (_, i) =>
    target.slice(0, i + 1),
  );
  assertMatchesFullRankAtEveryStep(rows, steps, { trial: "deterministic-8char" });
});

// --- Cache invalidation ---

test("invalidation: a changed filteredRows reference forces a full re-rank", () => {
  const rowA = makeRow("Alpha");
  const rowB = makeRow("Alphabet");
  const rowsBefore = [rowA];
  const rowsAfter = [rowA, rowB]; // e.g. a segment/tag change revealed rowB

  let cache: RankCacheEntry | undefined;
  const first = rankIncrementally(cache, {}, rowsBefore, "a", fullRankFn);
  cache = first.next;
  const second = rankIncrementally(cache, {}, rowsAfter, "al", fullRankFn);

  expect(summarize(second.ranked)).toEqual(summarize(fullRankFn(rowsAfter, "al")));
  expect(second.ranked.some((r) => r.row === rowB)).toBe(true);
});

test("invalidation: a changed view resets even when filteredRows is unchanged", () => {
  const rows = [makeRow("Alpha"), makeRow("Alphabet"), makeRow("Beta")];
  let cache: RankCacheEntry | undefined;
  const first = rankIncrementally(cache, { id: 1 }, rows, "a", fullRankFn);
  cache = first.next;
  const second = rankIncrementally(cache, { id: 2 }, rows, "al", fullRankFn);
  expect(summarize(second.ranked)).toEqual(summarize(fullRankFn(rows, "al")));
});

test("invalidation: segment change (new filteredRows array, same content) still forces full re-rank", () => {
  const rows = [makeRow("Alpha"), makeRow("Alphabet"), makeRow("Beta")];
  const rowsCopy = [...rows]; // same rows, different array identity
  let cache: RankCacheEntry | undefined;
  const first = rankIncrementally(cache, {}, rows, "a", fullRankFn);
  cache = first.next;
  const second = rankIncrementally(cache, {}, rowsCopy, "al", fullRankFn);
  expect(summarize(second.ranked)).toEqual(summarize(fullRankFn(rowsCopy, "al")));
});

test("tie-break order matches full ranking exactly (candidate subset preserves filteredRows order)", () => {
  // Every row here ties in score against "item" (all are prefix matches) --
  // only orderId (position in filteredRows) breaks the tie.
  const rows = [
    makeRow("Item Z"),
    makeRow("Item A"),
    makeRow("Item M"),
    makeRow("Item B"),
    makeRow("Item Y"),
  ];
  let cache: RankCacheEntry | undefined;
  const first = rankIncrementally(cache, {}, rows, "item", fullRankFn);
  cache = first.next;
  const second = rankIncrementally(cache, {}, rows, "item ", fullRankFn);
  cache = second.next;
  const third = rankIncrementally(cache, {}, rows, "item z", fullRankFn);

  expect(summarize(second.ranked)).toEqual(summarize(fullRankFn(rows, "item ")));
  expect(summarize(third.ranked)).toEqual(summarize(fullRankFn(rows, "item z")));
});
