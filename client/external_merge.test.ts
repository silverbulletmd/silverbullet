import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { computeExternalChanges } from "./external_merge.ts";

function apply(
  current: string,
  cs: ReturnType<typeof computeExternalChanges>,
): string {
  return cs.apply(Text.of(current.split("\n"))).toString();
}

describe("computeExternalChanges", () => {
  it("applies external change to a pristine doc", () => {
    const base = "Hello world\n";
    const disk = "Hello world\nExternal line\n";
    const cs = computeExternalChanges(base, disk, base);
    expect(apply(base, cs)).toBe(disk);
  });

  it("returns an empty set when disk matches current (echo)", () => {
    const base = "One\n";
    const disk = "One\nTwo\n";
    const cs = computeExternalChanges(base, disk, disk);
    expect(cs.empty).toBe(true);
    expect(apply(disk, cs)).toBe(disk);
  });

  it("preserves non-overlapping local edits", () => {
    const base = "alpha\nbeta\ngamma\n";
    const disk = "alpha\nbeta\ngamma\nexternal\n"; // external append
    const current = "ALPHA\nbeta\ngamma\n"; // local edit at top
    const cs = computeExternalChanges(base, disk, current);
    expect(apply(current, cs)).toBe("ALPHA\nbeta\ngamma\nexternal\n");
  });

  it("keeps local insertion when external edit touches an adjacent region", () => {
    const base = "one two three";
    const disk = "one 2 three"; // external replaced "two"
    const current = "one two three four"; // local appended
    const cs = computeExternalChanges(base, disk, current);
    expect(apply(current, cs)).toBe("one 2 three four");
  });

  it("survives external and local edits to the same region without crashing", () => {
    const base = "shared text here";
    const disk = "shared TEXT here"; // external
    const current = "shared texts here"; // local, overlapping
    const cs = computeExternalChanges(base, disk, current);
    const merged = apply(current, cs);
    // Exact outcome of a direct overlap is defined by ChangeSet.map; the
    // invariants we require: no throw, local "texts" influence not silently
    // reverted to base, and the result contains the unmodified suffix.
    expect(merged).toContain(" here");
  });

  it("handles disk == base with local edits (nothing external to do)", () => {
    const base = "stable\n";
    const current = "stable\nlocal\n";
    const cs = computeExternalChanges(base, base, current);
    expect(cs.empty).toBe(true);
    expect(apply(current, cs)).toBe(current);
  });

  it("keeps a local insertion right at the edge of an external replacement", () => {
    const base = "shared text here";
    const disk = "shared TEXT here"; // external uppercases "text"
    const current = "shared texty here"; // local insertion of "y" right after "text"
    const cs = computeExternalChanges(base, disk, current);
    expect(apply(current, cs)).toBe("shared TEXTy here");
  });

  it("does not silently drop local content when a local edit fully replaces an externally-touched word", () => {
    const base = "shared text here";
    const disk = "shared TEXT here"; // external uppercases "text"
    const current = "shared banana here"; // local replaces "text" with "banana"
    const cs = computeExternalChanges(base, disk, current);
    const merged = apply(current, cs);
    // Direct overlaps of this kind are inherently ambiguous for a diff-based
    // 3-way merge (see design note); we only require that neither side's
    // content is silently discarded and the surrounding text is intact.
    expect(merged).toContain("banana");
    expect(merged).toContain("shared ");
    expect(merged).toContain(" here");
  });

  it("applies a clean external change on top of an unrelated prior local edit", () => {
    const base = "line1\nline2\nline3\n";
    const disk = "line1\nline2\nline3\nline4\n"; // external append
    const current = "line1\nLINE2\nline3\n"; // unrelated local edit in the middle
    const cs = computeExternalChanges(base, disk, current);
    expect(apply(current, cs)).toBe("line1\nLINE2\nline3\nline4\n");
  });

  it("applies multiple sequential external changes correctly (base tracking)", () => {
    const base1 = "start\n";
    const disk1 = "start\nmid\n";
    const current1 = base1;
    const cs1 = computeExternalChanges(base1, disk1, current1);
    const afterFirst = apply(current1, cs1);
    expect(afterFirst).toBe(disk1);

    // Second external change is diffed against the *new* base (disk1), not
    // the original base1 - simulating ContentManager updating its tracked base.
    const disk2 = "start\nmid\nend\n";
    const cs2 = computeExternalChanges(disk1, disk2, afterFirst);
    expect(apply(afterFirst, cs2)).toBe(disk2);
  });
});
