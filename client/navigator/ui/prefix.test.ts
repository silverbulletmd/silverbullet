import { expect, test } from "vitest";
import { resolvePrefix, segmentFor } from "./prefix.ts";
import type { SegmentMeta, ViewMeta } from "../types.ts";

const segments: SegmentMeta[] = [
  { label: "All", hasWhere: false, default: true },
  { label: "Meta", hasWhere: true, prefix: "^" },
];

function meta(overrides: Partial<ViewMeta> = {}): ViewMeta {
  return {
    name: "v",
    title: "V",
    mode: "list",
    dock: "modal",
    hierarchy: { field: "name", separator: "/" },
    foldersFirst: true,
    expandAll: false,
    expansionScope: "view",
    followEditor: false,
    refreshOn: [],
    hasMove: false,
    hasCreate: false,
    refreshOnOpen: false,
    limit: 200,
    search: "client",
    hasRowIcon: false,
    pathCompletion: false,
    hashtagFilter: false,
    segments,
    prefixViews: { $: "std.anchors", "#": "std.tags" },
    ...overrides,
  };
}

test("a segment prefix activates its segment and drops the character", () => {
  expect(resolvePrefix(meta(), "", "^")).toEqual({
    kind: "segment",
    index: 1,
    rest: "",
  });
  expect(resolvePrefix(meta(), "", "^conf")).toEqual({
    kind: "segment",
    index: 1,
    rest: "conf",
  });
});

test("a prefix view routes to its sibling, carrying the rest", () => {
  expect(resolvePrefix(meta(), "", "$")).toEqual({
    kind: "view",
    view: "std.anchors",
    rest: "",
  });
  expect(resolvePrefix(meta(), "", "#todo")).toEqual({
    kind: "view",
    view: "std.tags",
    rest: "todo",
  });
});

test("routing only ever fires on the first character", () => {
  // The phrase was not empty: a `$` here is just a `$`.
  expect(resolvePrefix(meta(), "a", "a$")).toBeUndefined();
  expect(resolvePrefix(meta(), "notes", "notes #work")).toBeUndefined();
});

test("an unclaimed character is left alone", () => {
  expect(resolvePrefix(meta(), "", "x")).toBeUndefined();
  expect(resolvePrefix(meta(), "", "")).toBeUndefined();
  expect(resolvePrefix(undefined, "", "$")).toBeUndefined();
});

test("a multi-code-unit prefix is not split in half", () => {
  const m = meta({ prefixViews: { "📌": "std.pinned" }, segments: undefined });
  expect(resolvePrefix(m, "", "📌notes")).toEqual({
    kind: "view",
    view: "std.pinned",
    rest: "notes",
  });
});

test("a view without either mechanism routes nothing", () => {
  const m = meta({ segments: undefined, prefixViews: undefined });
  expect(resolvePrefix(m, "", "^")).toBeUndefined();
  expect(segmentFor(undefined, "^")).toBe(-1);
});

test("segmentFor finds only an exact character match", () => {
  expect(segmentFor(segments, "^")).toBe(1);
  expect(segmentFor(segments, "$")).toBe(-1);
});
