import { expect, test } from "vitest";
import {
  completeSegment,
  completionCandidate,
  folderPrefix,
  matchesTags,
  splitHashtags,
} from "./phrase.ts";
import type { Row } from "../types.ts";

function row(tags?: unknown): Row {
  return { obj: { name: "x", tags }, primary: "x" };
}

test("splitHashtags separates tags from the ranking phrase", () => {
  expect(splitHashtags("meeting")).toEqual({ tags: [], rest: "meeting" });
  expect(splitHashtags("#work")).toEqual({ tags: ["work"], rest: "" });
  expect(splitHashtags("#work notes #q3")).toEqual({
    tags: ["work", "q3"],
    rest: "notes",
  });
  // Purely numeric isn't a tag in the markdown syntax, so it stays phrase.
  expect(splitHashtags("#2024")).toEqual({ tags: [], rest: "#2024" });
  expect(splitHashtags("#<two words> plan")).toEqual({
    tags: ["two words"],
    rest: "plan",
  });
});

test("splitHashtags leaves a bare hash alone", () => {
  // Not a tag by the markdown syntax, so it stays part of the phrase.
  expect(splitHashtags("#")).toEqual({ tags: [], rest: "#" });
  expect(splitHashtags("a # b")).toEqual({ tags: [], rest: "a # b" });
});

test("matchesTags requires every tag, by prefix", () => {
  expect(matchesTags(row(["work", "meeting"]), [])).toBe(true);
  expect(matchesTags(row(["work", "meeting"]), ["work"])).toBe(true);
  expect(matchesTags(row(["work", "meeting"]), ["meet"])).toBe(true);
  expect(matchesTags(row(["work", "meeting"]), ["work", "meet"])).toBe(true);
  expect(matchesTags(row(["work"]), ["work", "meet"])).toBe(false);
});

test("matchesTags fails closed on rows with no tags", () => {
  expect(matchesTags(row(undefined), ["work"])).toBe(false);
  expect(matchesTags(row("work"), ["work"])).toBe(false);
  expect(matchesTags(row([1, 2]), ["work"])).toBe(false);
  // ... but an untagged phrase still admits them.
  expect(matchesTags(row(undefined), [])).toBe(true);
});

test("folderPrefix uses the containing folder, or the page itself at the root", () => {
  expect(folderPrefix("Projects/Alpha.md")).toBe("Projects/");
  expect(folderPrefix("A/B/C.md")).toBe("A/B/");
  expect(folderPrefix("index.md")).toBe("index/");
  expect(folderPrefix("Diagrams/flow.png")).toBe("Diagrams/");
  expect(folderPrefix("flow.png")).toBe("flow.png/");
});

test("completeSegment walks one path segment at a time", () => {
  expect(completeSegment("Pro", "Projects/Alpha/Notes")).toBe("Projects");
  expect(completeSegment("Projects", "Projects/Alpha/Notes")).toBe(
    "Projects/Alpha",
  );
  expect(completeSegment("Projects/Alpha", "Projects/Alpha/Notes")).toBe(
    "Projects/Alpha/Notes",
  );
  // Already whole: nothing left to walk to.
  expect(completeSegment("Projects/Alpha/Notes", "Projects/Alpha/Notes")).toBe(
    "Projects/Alpha/Notes",
  );
});

test("completeSegment jumps to the first segment when the phrase isn't a prefix", () => {
  expect(completeSegment("alpha", "Projects/Alpha")).toBe("Projects/");
  expect(completeSegment("", "Projects/Alpha")).toBe("Projects");
  expect(completeSegment("proj", "Projects/Alpha")).toBe("Projects");
});

test("completeSegment ignores trailing whitespace and empty candidates", () => {
  expect(completeSegment("Projects ", "Projects/Alpha")).toBe("Projects/Alpha");
  expect(completeSegment("Pro", undefined)).toBeUndefined();
  expect(completeSegment("Pro", "")).toBeUndefined();
});

test("completionCandidate walks past a row the phrase already matches whole", () => {
  const names = ["Projects/Beta", "Projects/Beta/Deep", "Projects/Alpha"];
  // Nothing typed yet, or a partial phrase: the top-ranked row.
  expect(completionCandidate(names, "")).toBe("Projects/Beta");
  expect(completionCandidate(names, "Projects")).toBe("Projects/Beta");
  // The phrase *is* the top row -- which can no longer extend it. The first
  // row that can wins instead, so the walk goes deeper rather than stalling.
  expect(completionCandidate(names, "Projects/Beta")).toBe(
    "Projects/Beta/Deep",
  );
  // Trailing whitespace doesn't count as typed.
  expect(completionCandidate(names, "Projects/Beta ")).toBe(
    "Projects/Beta/Deep",
  );
  // Case-insensitive, like the ranking that produced the list.
  expect(completionCandidate(names, "projects/beta")).toBe(
    "Projects/Beta/Deep",
  );
});

test("completionCandidate falls back to the top row, including nothing at all", () => {
  // No row extends the phrase: the top row is still the candidate, which is
  // what `completeSegment` turns into a jump to its first segment.
  expect(completionCandidate(["Projects/Alpha"], "zzz")).toBe("Projects/Alpha");
  expect(
    completionCandidate(["Projects/Beta/Deep"], "Projects/Beta/Deep"),
  ).toBe("Projects/Beta/Deep");
  expect(completionCandidate([], "anything")).toBeUndefined();
});
