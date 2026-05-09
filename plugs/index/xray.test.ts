import { describe, expect, it } from "vitest";
import {
  filterRangedEntries,
  groupByObject,
  renderObjectYaml,
} from "./xray.ts";

describe("filterRangedEntries", () => {
  it("keeps entries with a 2-element numeric range and drops the rest", () => {
    const entries = [
      { tag: "a", object: { tag: "a", ref: "p1", range: [0, 10] } },
      { tag: "b", object: { tag: "b", ref: "p2" } }, // no range
      { tag: "c", object: { tag: "c", ref: "p3", range: [1] } }, // arity 1
      { tag: "d", object: { tag: "d", ref: "p4", range: "0,5" } }, // wrong type
      { tag: "e", object: { tag: "e", ref: "p5", range: [3, 7] } },
    ];
    const out = filterRangedEntries(entries as any);
    expect(out.map((e) => e.tag)).toEqual(["a", "e"]);
    expect(out[0].object.range).toEqual([0, 10]);
  });
});

describe("groupByObject", () => {
  it("collapses consecutive entries that share ref and range", () => {
    const stack = [
      { tag: "link", object: { ref: "p1@5", range: [5, 15] } },
      { tag: "item", object: { ref: "p1@0", range: [0, 40] } },
      { tag: "athing", object: { ref: "p1@0", range: [0, 40] } },
    ];
    const groups = groupByObject(stack as any);
    expect(groups.map((g) => g.tags)).toEqual([
      ["link"],
      ["item", "athing"],
    ]);
  });

  it("does not merge non-adjacent entries even when ref+range match", () => {
    const stack = [
      { tag: "a", object: { ref: "x", range: [0, 10] } },
      { tag: "b", object: { ref: "y", range: [0, 10] } },
      { tag: "a-again", object: { ref: "x", range: [0, 10] } },
    ];
    const groups = groupByObject(stack as any);
    expect(groups.map((g) => g.tags)).toEqual([["a"], ["b"], ["a-again"]]);
  });

  it("returns empty for empty input", () => {
    expect(groupByObject([])).toEqual([]);
  });
});

describe("renderObjectYaml", () => {
  it("includes all attributes including range/pos/page", () => {
    const out = renderObjectYaml({
      tag: "link",
      ref: "Other@5",
      page: "Current",
      pos: 5,
      range: [5, 15],
      toPage: "Other",
    } as any);
    expect(out).toContain("tag: link");
    expect(out).toContain("ref: Other@5");
    expect(out).toContain("page: Current");
    expect(out).toContain("pos: 5");
    expect(out).toContain("range:");
    expect(out).toContain("toPage: Other");
  });

  it("renders nested attributes as nested YAML", () => {
    const out = renderObjectYaml({
      tag: "task",
      attrs: { state: " ", deadline: "2026-01-01" },
      tags: ["a", "b"],
    } as any);
    expect(out).toContain("attrs:");
    expect(out).toContain("  state: ' '");
    expect(out).toContain("tags:");
    expect(out).toContain("  - a");
    expect(out).toContain("  - b");
  });
});
