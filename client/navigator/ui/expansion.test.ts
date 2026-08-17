import { expect, test } from "vitest";
import { expansionKey } from "./expansion.ts";

test("expansionKey keeps the two readings apart", () => {
  expect(
    expansionKey("someTree", { expandAll: true, expansionScope: "view" }),
  ).toEqual(["navigator", "someTree", "collapsed"]);
  expect(
    expansionKey("std.spaceTree", { expandAll: false, expansionScope: "view" }),
  ).toEqual(["navigator", "std.spaceTree", "expanded"]);
});

test("expansionKey: a page-scoped tree has nowhere to persist to", () => {
  // Its paths are one page's content, so a stored set would land on top of a
  // different page's rows -- see the `expansionScope` docs.
  expect(
    expansionKey("std.toc", { expandAll: true, expansionScope: "page" }),
  ).toBeUndefined();
  expect(
    expansionKey("std.toc", { expandAll: false, expansionScope: "page" }),
  ).toBeUndefined();
});

test("expansionKey: an ephemeral (navigator.pick) view has nowhere to persist to either", () => {
  expect(
    expansionKey("__pick:1", {
      expandAll: true,
      expansionScope: "view",
      ephemeral: true,
    }),
  ).toBeUndefined();
});
