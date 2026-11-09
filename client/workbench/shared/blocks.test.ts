import { expect, test } from "vitest";
import {
  blockLabels,
  blockRank,
  blockSourceRef,
  blocksFrom,
  currentBlockStart,
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

test("a block is found again after the page above it changed", () => {
  const fence = "```";
  const page = (intro: string, b = ".b {}") =>
    `# Styles\n${intro}\n${fence}space-style\n.a {}\n${fence}\n\n${fence}space-style\n${b}\n${fence}\n`;
  const before = page("");
  const bAt = before.indexOf(`${fence}space-style\n.b`);
  const intro = "A new paragraph.\n\nAnother one.\n";
  // Same code: found wherever it moved
  const moved = page(intro);
  expect(currentBlockStart(moved, "space-style", ".b {}", bAt, 1)).toBe(
    moved.indexOf(".b {}"),
  );
  // Code edited too: the block at the same rank on the page
  const edited = page(intro, ".b { color: red; }");
  expect(currentBlockStart(edited, "space-style", ".b {}", bAt, 1)).toBe(
    edited.indexOf(".b { color"),
  );
  // Only blocks of the same kind count
  expect(
    currentBlockStart(moved, "space-lua", ".b {}", bAt, 1),
  ).toBeUndefined();
});

test("a block's rank counts the blocks before it on its page", () => {
  expect(blockRank(blocks, "Scratch/Helpers@212")).toBe(1);
  expect(blockRank(blocks, "Scratch/Helpers@0")).toBe(0);
  expect(blockRank(blocks, "Journal@40")).toBe(0);
});
