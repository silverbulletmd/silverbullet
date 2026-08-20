import { expect, test } from "vitest";
import { containsConflictMarkers } from "./conflict.ts";

const oneHunk = [
  "Some intro text.",
  "",
  "<<<<<<< SB sha256:aaaa1111",
  "first version line",
  "||||||| SB BASE sha256:base1111",
  "base line",
  "=======",
  "second version line",
  ">>>>>>> SB sha256:bbbb2222",
  "",
  "Trailing text.",
].join("\n");

const twoHunks = [
  "<<<<<<< SB sha256:aaaa1111",
  "first version line",
  "||||||| SB BASE sha256:base1111",
  "base line",
  "=======",
  "second version line",
  ">>>>>>> SB sha256:bbbb2222",
  "",
  "Some unrelated paragraph.",
  "",
  "<<<<<<< SB sha256:cccc3333",
  "another first version line",
  "||||||| SB BASE sha256:base4444",
  "another base line",
  "=======",
  "another second version line",
  ">>>>>>> SB sha256:dddd5555",
].join("\n");

test("containsConflictMarkers: true for SB markers", () => {
  expect(containsConflictMarkers(oneHunk)).toBe(true);
});

// A complete git-conflict hunk (two-way, no diff3 base) is now recognized
// alongside SB's own grammar — spaces kept in git can carry these too.
test("containsConflictMarkers: true for a complete git-style hunk", () => {
  const gitStyle = [
    "<<<<<<< HEAD",
    "first version line",
    "=======",
    "second version line",
    ">>>>>>> branch",
  ].join("\n");
  expect(containsConflictMarkers(gitStyle)).toBe(true);
});

test("containsConflictMarkers: true for a git diff3 hunk with a base section", () => {
  const gitDiff3 = [
    "<<<<<<< HEAD",
    "first version line",
    "||||||| merged common ancestors",
    "base line",
    "=======",
    "second version line",
    ">>>>>>> branch",
  ].join("\n");
  expect(containsConflictMarkers(gitDiff3)).toBe(true);
});

test("containsConflictMarkers: false for an incomplete git-style marker", () => {
  const incomplete = [
    "<<<<<<< HEAD",
    "first version line",
    "=======",
    "second version line",
    // no closing ">>>>>>> branch" line
  ].join("\n");
  expect(containsConflictMarkers(incomplete)).toBe(false);
});

test("containsConflictMarkers: false for a fenced code block with a full git example", () => {
  const fenced = [
    "Docs about resolving conflicts:",
    "",
    "```",
    "<<<<<<< HEAD",
    "first version line",
    "=======",
    "second version line",
    ">>>>>>> branch",
    "```",
    "",
    "The rest of the page.",
  ].join("\n");
  expect(containsConflictMarkers(fenced)).toBe(false);
});

// SB's grammar can't false-positive, so fence-masking must never suppress
// it — mirrors the same rule (and regression) fixed in the widget's
// findConflictHunks.
test("containsConflictMarkers: true for an SB hunk whose sides contain fence openers", () => {
  const text = [
    "<<<<<<< SB sha256:aaaa1111",
    "```js",
    "first version line",
    "||||||| SB BASE sha256:base1111",
    "base line",
    "=======",
    "```js",
    "second version line",
    ">>>>>>> SB sha256:bbbb2222",
  ].join("\n");
  expect(containsConflictMarkers(text)).toBe(true);
});

test("containsConflictMarkers: true for an SB hunk that follows an earlier unclosed fence", () => {
  const text = [
    "Docs:",
    "```",
    "example, never closed",
    "<<<<<<< SB sha256:aaaa1111",
    "first version line",
    "||||||| SB BASE sha256:base1111",
    "base line",
    "=======",
    "second version line",
    ">>>>>>> SB sha256:bbbb2222",
  ].join("\n");
  expect(containsConflictMarkers(text)).toBe(true);
});

test("containsConflictMarkers: false for plain text", () => {
  expect(
    containsConflictMarkers("Just a regular page.\n\nNo markers here.\n"),
  ).toBe(false);
});

test("containsConflictMarkers: true for multiple SB hunks", () => {
  expect(containsConflictMarkers(twoHunks)).toBe(true);
});

test("containsConflictMarkers: detects mixed SB and git hunks", () => {
  const mixed = [
    "<<<<<<< SB sha256:aaaa1111",
    "first",
    "||||||| SB BASE sha256:base1111",
    "base",
    "=======",
    "second",
    ">>>>>>> SB sha256:bbbb2222",
    "",
    "<<<<<<< HEAD",
    "git first",
    "=======",
    "git second",
    ">>>>>>> branch",
  ].join("\n");
  expect(containsConflictMarkers(mixed)).toBe(true);
});
