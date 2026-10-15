import { beforeEach, expect, test } from "vitest";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import {
  applyEdits,
  checkWritable,
  editedSpans,
  findTarget,
  inlineYaml,
  isPageTarget,
  kindOf,
  minimalEdit,
} from "./object_edit.ts";
import { inlineHandler } from "./object_edit_inline.ts";
import { PAGE_READ_ONLY } from "./object_edit_page.ts";
import { objectsOf } from "./object_test_util.ts";

beforeEach(() => {
  createMockSystem();
});

test("applyEdits applies non-overlapping edits and rejects overlaps", () => {
  expect(
    applyEdits("abcdef", [
      { from: 4, to: 5, insert: "E" },
      { from: 0, to: 1, insert: "AA" },
    ]),
  ).toBe("AAbcdEf");
  expect(() =>
    applyEdits("abcdef", [
      { from: 0, to: 3, insert: "" },
      { from: 2, to: 4, insert: "" },
    ]),
  ).toThrow("these changes overlap");
});

test("editedSpans reports where each edit landed in the new text", () => {
  expect(
    editedSpans([
      { from: 4, to: 5, insert: "E" },
      { from: 0, to: 1, insert: "AA" },
    ]),
  ).toEqual([
    [0, 2],
    [5, 6],
  ]);
});

test("minimalEdit trims the common prefix and suffix", () => {
  expect(minimalEdit("abc", "abc")).toEqual([]);
  expect(minimalEdit("a-b-c", "a-XY-c")).toEqual([
    { from: 2, to: 3, insert: "XY" },
  ]);
});

test("inlineYaml keeps strings strings when YAML would read another type", () => {
  expect(inlineYaml("hello")).toBe("hello");
  expect(inlineYaml("2026-11-01")).toBe('"2026-11-01"');
  expect(inlineYaml("true")).toBe('"true"');
  expect(inlineYaml("12")).toBe('"12"');
  expect(inlineYaml("a]b")).toBe('"a\\u005db"');
  expect(inlineYaml(12)).toBe("12");
  expect(inlineYaml(false)).toBe("false");
  expect(inlineYaml(null)).toBe("null");
  expect(inlineYaml(["a", "b"])).toBe('["a","b"]');
});

test("kindOf and isPageTarget", () => {
  expect(kindOf({ tag: "task" })).toBe("task");
  expect(kindOf({ tag: "expense", itags: ["data"] })).toBe("data");
  expect(kindOf({ tag: "anchor" })).toBeNull();
  expect(isPageTarget({ page: "Notes", ref: "Notes", tag: "page" })).toBe(true);
  expect(isPageTarget({ page: "Notes", ref: "Notes" })).toBe(true);
  expect(isPageTarget({ page: "Notes", ref: "Notes@3", range: [3, 9] })).toBe(
    false,
  );
});

test("findTarget picks the task, not the anchor object with the same ref", async () => {
  const text = "* [ ] Call Pete $call-pete\n";
  const fresh = await objectsOf(text);
  const found = findTarget(fresh, {
    page: "Notes",
    ref: "call-pete",
  });
  expect(found.tag).toBe("task");
});

test("findTarget fails on a stale position ref instead of editing a neighbour", async () => {
  const original = "* [ ] A #x\n* [ ] B #x\n";
  const [a] = (await objectsOf(original)).filter((o) => o.tag === "task");
  // Text inserted above shifts every position
  const shifted = await objectsOf(`Intro\n\n${original}`);
  expect(() => findTarget(shifted, a as any)).toThrow(
    "object moved or was removed from Notes, query again",
  );
  // Same position, different object
  const replaced = await objectsOf("* [ ] Z #x\n* [ ] B #x\n");
  expect(() => findTarget(replaced, a as any)).toThrow("object moved");
});

test("findTarget reports a missing anchor", async () => {
  const fresh = await objectsOf("* [ ] A\n");
  expect(() => findTarget(fresh, { page: "Notes", ref: "gone" })).toThrow(
    "Notes has no object $gone",
  );
});

test("checkWritable rejects derived attributes", () => {
  const task = inlineHandler("task").readOnly;
  expect(() => checkWritable("task", task, ["due"])).not.toThrow();
  expect(() => checkWritable("task", task, ["text"])).toThrow(
    '"text" can\'t be changed on a task',
  );
  expect(() => checkWritable("page", PAGE_READ_ONLY, ["name"])).toThrow(
    '"name" can\'t be changed on a page',
  );
});
