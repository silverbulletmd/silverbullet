import { expect, test } from "vitest";
import { findRenameConflict, shouldDeleteOldPath } from "./refactor_case.ts";

const space = ["index.md", "Notes/a.md", "bar.md", "OldName.md"];

test("a free target has no conflict", () => {
  expect(findRenameConflict(space, "OldName.md", "Fresh.md")).toBeUndefined();
});

test("an exact match is reported so the caller can say 'already exists'", () => {
  expect(findRenameConflict(space, "OldName.md", "bar.md")).toBe("bar.md");
});

test("a case-insensitive near-match is reported as a collision", () => {
  expect(findRenameConflict(space, "OldName.md", "Bar.md")).toBe("bar.md");
});

test("a file never conflicts with its own old path", () => {
  expect(findRenameConflict(space, "OldName.md", "oldname.md")).toBeUndefined();
});

test("a folder case change does not conflict with itself", () => {
  expect(findRenameConflict(space, "Notes/a.md", "notes/a.md")).toBeUndefined();
});

test("a folder case change still collides with an unrelated file", () => {
  expect(findRenameConflict([...space, "notes/b.md"], "Notes/a.md", "notes/B.md"))
    .toBe("notes/b.md");
});

const dup = ["Foo.md", "foo.md"];

test("a pre-existing case-variant of a different file is still a real collision", () => {
  expect(findRenameConflict(dup, "Foo.md", "foo.md")).toBe("foo.md");
});

test("case-only rename deletes the old path once the new casing landed", () => {
  expect(shouldDeleteOldPath("OldName.md", "oldname.md", true)).toBe(true);
});

test("case-only rename skips the delete when the new casing didn't land", () => {
  expect(shouldDeleteOldPath("OldName.md", "oldname.md", false)).toBe(false);
});

test("a genuine rename deletes the old path regardless of the flag (true)", () => {
  expect(shouldDeleteOldPath("OldName.md", "NewName.md", true)).toBe(true);
});

test("a genuine rename deletes the old path regardless of the flag (false)", () => {
  expect(shouldDeleteOldPath("OldName.md", "NewName.md", false)).toBe(true);
});
