import { expect, test } from "vitest";
import {
  blockLabels,
  blockSourceRef,
  blocksFrom,
  originCounts,
} from "./blocks.ts";

const blocks = [
  { ref: "Library/Std/Config@0" },
  { ref: "Scratch/Helpers@0" },
  { ref: "Scratch/Helpers@212" },
  { ref: "Journal@40" },
];
const refs = (bs: { ref: string }[]) => bs.map((b) => b.ref);

test("built-in blocks are the ones on Library/Std pages", () => {
  expect(refs(blocksFrom(blocks, "builtin"))).toEqual(["Library/Std/Config@0"]);
  expect(refs(blocksFrom(blocks, "custom"))).toEqual([
    "Scratch/Helpers@0",
    "Scratch/Helpers@212",
    "Journal@40",
  ]);
  expect(blocksFrom(blocks, "all")).toBe(blocks);
  expect(originCounts(blocks)).toEqual({ all: 4, custom: 3, builtin: 1 });
});

test("labels show the offset only for pages with several blocks", () => {
  const labels = blockLabels(blocks);
  expect(labels.get("Journal@40")).toEqual({ page: "Journal" });
  expect(labels.get("Scratch/Helpers@212")).toEqual({
    page: "Scratch/Helpers",
    pos: 212,
  });
});

test("a block's source starts after its opening fence line", () => {
  expect(blockSourceRef("Journal@40", "space-lua")).toEqual({
    path: "Journal.md",
    details: { type: "position", pos: 40 + "```space-lua\n".length },
  });
  expect(blockSourceRef("Journal@40", "space-style")?.details).toEqual({
    type: "position",
    pos: 40 + "```space-style\n".length,
  });
});
