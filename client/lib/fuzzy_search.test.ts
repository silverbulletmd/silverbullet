import { expect, test } from "vitest";
import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";
import {
  fuzzySearchAndSort,
  scoreCandidate,
  scoreToken,
} from "./fuzzy_search.ts";

type Expect = {
  topMatch?: string;
  mustIncludeInTopN?: string[];
  n?: number;
  mustExclude?: string[];
  resultCount?: number;
};

function assertSearch(
  corpus: FilterOption[],
  query: string,
  expected: Expect,
): void {
  const results = fuzzySearchAndSort(corpus, query);
  const names = results.map((r) => r.name);
  const detail = `\nQuery: ${JSON.stringify(query)}\nRanked: ${
    JSON.stringify(names, null, 2)
  }`;
  if (expected.resultCount !== undefined) {
    expect(results.length, "result count" + detail).toEqual(
      expected.resultCount,
    );
  }
  if (expected.topMatch !== undefined) {
    expect(names[0], "top match" + detail).toEqual(expected.topMatch);
  }
  if (expected.mustIncludeInTopN) {
    const n = expected.n ?? expected.mustIncludeInTopN.length;
    const topN = names.slice(0, n);
    for (const name of expected.mustIncludeInTopN) {
      expect(topN, `expected ${name} in top ${n}` + detail).toContain(name);
    }
  }
  if (expected.mustExclude) {
    for (const name of expected.mustExclude) {
      expect(names, `expected ${name} excluded` + detail).not.toContain(name);
    }
  }
}

test("motivating bug: 'silv todo' matches 'SilverBullet/TODO'", () => {
  const corpus: FilterOption[] = [
    { name: "SilverBullet/TODO" },
    { name: "Silver" },
    { name: "TODO" },
    { name: "Silver/Other" },
  ];
  assertSearch(corpus, "silv todo", { topMatch: "SilverBullet/TODO" });
});

test("scoreToken: exact case-insensitive equality scores 1.0", () => {
  expect(scoreToken("todo", "TODO")).toBeCloseTo(1.0, 5);
  expect(scoreToken("Silver", "silver")).toBeCloseTo(1.0, 5);
});

test("scoreToken: prefix at start scores 0.95 (always word boundary)", () => {
  expect(scoreToken("silv", "silverbullet")).toBeCloseTo(0.95, 5);
  expect(scoreToken("silv", "Silver/Other")).toBeCloseTo(0.95, 5);
});

test("scoreToken: substring scores 0.75 (plain) or 0.80 (word boundary)", () => {
  expect(scoreToken("ver", "Silver")).toBeCloseTo(0.75, 5);
  expect(scoreToken("silver", "Some/Silver/Thing")).toBeCloseTo(0.80, 5);
});

test("scoreToken: no match returns 0 (before tiers 4/5 implemented)", () => {
  expect(scoreToken("xyz", "Silver")).toEqual(0);
});

test("scoreToken: subsequence with gaps scores between 0.30 and 0.65", () => {
  const s = scoreToken("slvr", "SilverBullet");
  expect(s).toBeGreaterThan(0.3);
  expect(s).toBeLessThanOrEqual(0.65);
});

test("scoreToken: subsequence with word-boundary starts ranks higher than scattered", () => {
  const boundary = scoreToken("pae", "PageEditor"); // P-a-...-e at word starts
  const scattered = scoreToken("pae", "appendage"); // scattered chars
  expect(boundary).toBeGreaterThan(scattered);
});

test("scoreToken: contiguous subsequence scores higher than gapped", () => {
  const contiguous = scoreToken("slvr", "slvrabcdef");
  const gapped = scoreToken("slvr", "s_l_v_r_abc");
  expect(contiguous).toBeGreaterThan(gapped);
});

test("scoreToken: typo tolerance matches when token length >= 4 and edits <= 2", () => {
  // 'slverbullet' vs 'silverbullet' = 1 deletion
  const s = scoreToken("slverbullet", "silverbullet");
  expect(s).toBeGreaterThan(0); // some typo-tier match
  // But it must be lower than an exact match would be
  expect(s).toBeLessThan(scoreToken("silverbullet", "silverbullet"));
});

test("scoreToken: short tokens (<4 chars) do NOT get typo tolerance", () => {
  // 'cot' is not a subsequence of 'cat' (different middle char), edit distance 1
  // For length 3, no typo tolerance.
  expect(scoreToken("cot", "cat")).toEqual(0);
});

test("scoreToken: typo with too many edits returns 0", () => {
  // 'abcde' vs 'xyzab' has edit distance > 2 — should not match
  expect(scoreToken("abcde", "xyzab")).toEqual(0);
});

test("scoreCandidate: multi-token AND requires every token to match", () => {
  const opt: FilterOption = { name: "SilverBullet/TODO" };
  expect(scoreCandidate("silv todo", opt)).not.toBeNull();
  // 'xyz' fails — whole candidate fails
  expect(scoreCandidate("silv xyz", opt)).toBeNull();
});

test("scoreCandidate: scores against displayName and aliases", () => {
  const opt: FilterOption = {
    name: "internal/x",
    meta: { displayName: "Project Tasks", aliases: ["todos"] },
  };
  expect(scoreCandidate("project", opt)).not.toBeNull();
  expect(scoreCandidate("todos", opt)).not.toBeNull();
});

test("scoreCandidate: description is NOT searched", () => {
  const opt: FilterOption = {
    name: "internal/x",
    description: "some description text",
  };
  expect(scoreCandidate("description", opt)).toBeNull();
});

test("scoreCandidate: basename match outscores name-only match", () => {
  const basenameMatch: FilterOption = { name: "Other/Steve" };
  const nameOnly: FilterOption = { name: "Steve/Other" };
  // 'Steve' is basename in first, not in second
  const a = scoreCandidate("Steve", basenameMatch)!;
  const b = scoreCandidate("Steve", nameOnly)!;
  expect(a).toBeGreaterThan(b);
});

test("seed 1: 'silv todo' matches SilverBullet/TODO", () => {
  assertSearch(
    [
      { name: "SilverBullet/TODO" },
      { name: "Silver" },
      { name: "TODO" },
      { name: "Silver/Other" },
    ],
    "silv todo",
    { topMatch: "SilverBullet/TODO" },
  );
});

test("seed 2: 'silverbullet' exact wins, all SilverBullet/* in top-3", () => {
  assertSearch(
    [
      { name: "SilverBullet/TODO" },
      { name: "SilverBullet/Notes" },
      { name: "SilverBullet" },
    ],
    "silverbullet",
    {
      topMatch: "SilverBullet",
      mustIncludeInTopN: ["SilverBullet/TODO", "SilverBullet/Notes"],
      n: 3,
    },
  );
});

test("seed 3: 'pae' matches PageEditor via subsequence", () => {
  assertSearch(
    [
      { name: "PageEditor" },
      { name: "PathEditor" },
      { name: "Other" },
    ],
    "pae",
    { mustIncludeInTopN: ["PageEditor", "PathEditor"], n: 2 },
  );
});

test("seed 4: 'slverbullet' typo matches SilverBullet", () => {
  assertSearch(
    [
      { name: "SilverBullet" },
      { name: "Silver" },
      { name: "Bullet" },
    ],
    "slverbullet",
    { topMatch: "SilverBullet" },
  );
});

test("seed 5: 'Co' prefers basename match", () => {
  assertSearch(
    [
      { name: "My Company/Hank", orderId: 2 },
      { name: "My Company/Hane", orderId: 1 },
      { name: "My Company/Steve Co" },
      { name: "Other/Steve" },
      { name: "Steve" },
    ],
    "Co",
    {
      topMatch: "My Company/Steve Co",
      mustIncludeInTopN: ["My Company/Hane", "My Company/Hank"],
      n: 3,
    },
  );
});

test("seed 6: 'in' prefix beats subsequence; no typo tolerance on short", () => {
  assertSearch(
    [
      { name: "Inbox" },
      { name: "In Progress" },
      { name: "Index" },
    ],
    "in",
    {
      mustIncludeInTopN: ["Inbox", "In Progress", "Index"],
      n: 3,
    },
  );
});

test("seed 7: 'daily 02' matches Daily/2024-02-15", () => {
  assertSearch(
    [
      { name: "Daily/2024-01-15" },
      { name: "Daily/2024-02-15" },
    ],
    "daily 02",
    { topMatch: "Daily/2024-02-15", resultCount: 1 },
  );
});

test("seed 8: no matches returns empty", () => {
  assertSearch(
    [{ name: "Foo" }, { name: "Bar" }],
    "xyz",
    { resultCount: 0 },
  );
});

test("seed 9: empty query sorts by orderId, aspiring (Infinity) last", () => {
  assertSearch(
    [
      { name: "Existing", orderId: 1 },
      { name: "Aspiring A", orderId: Infinity },
      { name: "Aspiring B", orderId: Infinity },
    ],
    "",
    {
      topMatch: "Existing",
      resultCount: 3,
      mustIncludeInTopN: ["Existing", "Aspiring A", "Aspiring B"],
      n: 3,
    },
  );
});

test("seed 10: 'readme' case-insensitive matches both", () => {
  assertSearch(
    [{ name: "README" }, { name: "readme.md" }],
    "readme",
    {
      mustIncludeInTopN: ["README", "readme.md"],
      n: 2,
    },
  );
});

test("seed 11: alias matching", () => {
  assertSearch(
    [
      { name: "internal/projects", meta: { aliases: ["todos", "tasks"] } },
      { name: "other" },
    ],
    "todos",
    { topMatch: "internal/projects" },
  );
});

test("seed 12: 1-2 char queries do not match via typo tolerance", () => {
  assertSearch(
    [{ name: "cat" }, { name: "dog" }],
    "co",
    { resultCount: 0 },
  );
});

test("preserves existing testFuzzyFilter behavior", () => {
  const array: FilterOption[] = [
    { name: "My Company/Hank", orderId: 2 },
    { name: "My Company/Hane", orderId: 1 },
    { name: "My Company/Steve Co" },
    { name: "Other/Steve" },
    { name: "Steve" },
  ];
  let results = fuzzySearchAndSort(array, "");
  expect(results.length).toEqual(array.length);
  results = fuzzySearchAndSort(array, "Steve");
  expect(results.length).toEqual(3);
  results = fuzzySearchAndSort(array, "Co");
  expect(results[0].name).toEqual("My Company/Steve Co");
});
