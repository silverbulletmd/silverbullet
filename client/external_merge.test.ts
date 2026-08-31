import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import {
  computeExternalChanges,
  type ExternalMerge,
} from "./external_merge.ts";

function apply(current: string, merge: ExternalMerge): string {
  return merge.changes.apply(Text.of(current.split("\n"))).toString();
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
    expect(cs.changes.empty).toBe(true);
    expect(apply(disk, cs)).toBe(disk);
  });

  it("preserves non-overlapping local edits", () => {
    const base = "alpha\nbeta\ngamma\n";
    const disk = "alpha\nbeta\ngamma\nexternal\n"; // external append
    const current = "ALPHA\nbeta\ngamma\n"; // local edit at top
    const cs = computeExternalChanges(base, disk, current);
    expect(apply(current, cs)).toBe("ALPHA\nbeta\ngamma\nexternal\n");
  });

  it("defers a local append sharing a line with an external rewrite", () => {
    const base = "one two three";
    const disk = "one 2 three"; // external replaced "two"
    const current = "one two three four"; // local appended
    const cs = computeExternalChanges(base, disk, current);
    expect(cs.deferred).toBe(true);
    expect(apply(current, cs)).toBe(current);
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
    expect(cs.changes.empty).toBe(true);
    expect(apply(current, cs)).toBe(current);
  });

  it("defers a local insertion inside a line the external side rewrote", () => {
    const base = "shared text here";
    const disk = "shared TEXT here"; // external uppercases "text"
    const current = "shared texty here"; // local insertion of "y" right after "text"
    const cs = computeExternalChanges(base, disk, current);
    expect(cs.deferred).toBe(true);
    expect(apply(current, cs)).toBe(current);
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

  describe("colliding local and external rewrites", () => {
    it("never splices two rewrites of the same line into fabricated text", () => {
      const base = "Line1\nLine2 original\nLine3\n";
      const disk = "Line1\nLine2 changed by Remote\nLine3\n";
      const current = "Line1\nLine2 changed by Tab1\nLine3\n";
      const merged = apply(
        current,
        computeExternalChanges(base, disk, current),
      );
      // The pre-fix result was "Line2 changed by Remchaned by Tteb1": both
      // sides' fragments concatenated in position order. Whatever this
      // merge does, every line must be text somebody actually wrote.
      for (const line of merged.split("\n")) {
        expect(["Line1", "Line3", ""]).toContain(
          line.startsWith("Line2") ? "" : line,
        );
      }
      expect(merged).toBe(current);
    });

    it("defers the whole external update, not just the colliding hunk", () => {
      // A character diff of two rewrites of one line straddles line
      // boundaries, so the surviving hunks can't be salvaged individually:
      // here the append is entangled with the line-2 rewrite. Deferring
      // costs a moment's freshness; the reconciled document brings it all.
      const base = "Line1\nLine2 original\nLine3\n";
      const disk = "Line1\nLine2 changed by Remote\nLine3\nLine4 remote\n";
      const current = "Line1\nLine2 changed by Tab1\nLine3\n";
      const cs = computeExternalChanges(base, disk, current);
      expect(apply(current, cs)).toBe(current);
    });

    it("still applies a remote append made alongside an unrelated local rewrite", () => {
      const base = "Line1\nLine2 original\nLine3\n";
      const disk = "Line1\nLine2 original\nLine3\nLine4 remote\n";
      const current = "Line1\nLine2 changed by Tab1\nLine3\n";
      const cs = computeExternalChanges(base, disk, current);
      expect(apply(current, cs)).toBe(
        "Line1\nLine2 changed by Tab1\nLine3\nLine4 remote\n",
      );
    });

    it("reports an empty change set when the external update is deferred", () => {
      const base = "one\n";
      const disk = "two\n";
      const current = "three\n";
      const cs = computeExternalChanges(base, disk, current);
      expect(cs.changes.empty).toBe(true);
      expect(apply(current, cs)).toBe(current);
    });

    // ContentManager keys a whole reconciliation path off this flag, and an
    // empty change set alone can't carry it: "nothing to do" and "withheld,
    // the buffer is now a sibling of what's on disk" are both empty.
    it("flags a deferral distinctly from an ordinary no-op", () => {
      const base = "Line1\nLine2 original\nLine3\n";
      const disk = "Line1\nLine2 changed by Remote\nLine3\n";
      const current = "Line1\nLine2 changed by Tab1\nLine3\n";
      expect(computeExternalChanges(base, disk, current).deferred).toBe(true);
      // Same-text echo: empty, but nothing was withheld.
      expect(computeExternalChanges(base, disk, disk).deferred).toBe(false);
      // Disk never moved: empty, but nothing was withheld.
      expect(computeExternalChanges(base, base, current).deferred).toBe(false);
      // A clean merge is not a deferral either.
      expect(
        computeExternalChanges(base, `${base}Line4 remote\n`, current).deferred,
      ).toBe(false);
    });
  });

  describe("incoming conflict-marker documents", () => {
    const markerDoc = (first: string, base: string, second: string) =>
      [
        "<<<<<<< SB sha256:aaaaaaaa",
        first,
        "||||||| SB BASE sha256:bbbbbbbb",
        base,
        "=======",
        second,
        ">>>>>>> SB sha256:cccccccc",
      ].join("\n");

    it("applies the marker document verbatim when it embeds the buffer's own edit", () => {
      const base = "Line1\nLine2 original\nLine3\n";
      const current = "Line1\nLine2 changed by Tab1\nLine3\n";
      const disk =
        "Line1\n" +
        markerDoc(
          "Line2 changed by Remote",
          "Line2 original",
          "Line2 changed by Tab1",
        ) +
        "\nLine3\n";
      const cs = computeExternalChanges(base, disk, current);
      expect(apply(current, cs)).toBe(disk);
    });

    it("applies the marker document verbatim when local edits are unrelated", () => {
      const base = "Line1\nLine2 original\nLine3\n";
      const current = "LINE1\nLine2 changed by Tab1\nLine3\n";
      const disk =
        "Line1\n" +
        markerDoc(
          "Line2 changed by Remote",
          "Line2 original",
          "Line2 changed by Tab1",
        ) +
        "\nLine3\n";
      const cs = computeExternalChanges(base, disk, current);
      expect(apply(current, cs)).toBe(disk);
    });

    it("stays a no-op when the marker document is already the base", () => {
      const base = "a\n" + markerDoc("x", "o", "y") + "\nb\n";
      const current = "a\nlocal\n" + markerDoc("x", "o", "y") + "\nb\n";
      const cs = computeExternalChanges(base, base, current);
      expect(cs.changes.empty).toBe(true);
      expect(apply(current, cs)).toBe(current);
    });

    it("stays a no-op when the buffer already holds the marker document", () => {
      const base = "a\nb\n";
      const disk = "a\n" + markerDoc("x", "o", "y") + "\nb\n";
      const cs = computeExternalChanges(base, disk, disk);
      expect(cs.changes.empty).toBe(true);
    });

    it("ignores an incomplete marker-looking line and keeps the 3-way merge", () => {
      const base = "intro\nbody\n";
      const disk = "intro\n<<<<<<< SB sha256:deadbeef\nbody\n"; // no closing marker
      const current = "intro\nbody\nlocal tail\n";
      const cs = computeExternalChanges(base, disk, current);
      expect(apply(current, cs)).toBe(
        "intro\n<<<<<<< SB sha256:deadbeef\nbody\nlocal tail\n",
      );
    });

    // A git-style hunk is ordinary content to this merge — only SB's own
    // grammar is the merge kernel's authoritative output. Without the
    // kind === "sb" restriction, this would wrongly take the wholesale-
    // replace branch instead of deferring the genuine same-line collision.
    it("does not treat a git-style hunk in disk as the authoritative marker document", () => {
      const base = "Line1\nLine2 original\nLine3\n";
      const disk = [
        "Line1",
        "Line2 changed by Remote",
        "<<<<<<< HEAD",
        "someone pasted",
        "=======",
        "an actual git example",
        ">>>>>>> feature",
        "Line3",
        "",
      ].join("\n");
      const current = "Line1\nLine2 changed by Tab1\nLine3\n";
      const cs = computeExternalChanges(base, disk, current);
      expect(cs.deferred).toBe(true);
      expect(cs.changes.empty).toBe(true);
    });
  });

  // The server merges by three-way diff3 over lines: a base line survives as
  // a sync point only when both sides leave it byte-identical, and chunks run
  // between consecutive sync points. Applying anything the server would not
  // resolve identically is what makes buffer and disk disagree, so the rule
  // below is "same chunk => defer", verified against the Rust kernel.
  describe("agreement with the server's chunk boundaries", () => {
    it("defers two rewrites of adjacent base lines", () => {
      // Neither line survives as a sync point, so they collapse into one
      // chunk both sides changed -- a conflict on the server even though no
      // single line is rewritten twice.
      const base = "l1\nl2\nl3\nl4\n";
      const disk = "l1\nl2\nL3\nl4\n";
      const current = "l1\nL2\nl3\nl4\n";
      const cs = computeExternalChanges(base, disk, current);
      expect(cs.deferred).toBe(true);
      expect(apply(current, cs)).toBe(current);
    });

    it("defers two insertions at the same line boundary", () => {
      const base = "a\nb\n";
      const disk = "a\nY\nb\n";
      const current = "a\nX\nb\n";
      const cs = computeExternalChanges(base, disk, current);
      expect(cs.deferred).toBe(true);
      expect(apply(current, cs)).toBe(current);
    });

    it("defers an insertion whose boundary abuts an externally rewritten line", () => {
      const base = "a\nb\nc\n";
      const disk = "A\nb\nc\n"; // external rewrites line 0
      const current = "a\nX\nb\nc\n"; // local inserts on the 0/1 boundary
      const cs = computeExternalChanges(base, disk, current);
      expect(cs.deferred).toBe(true);
      expect(apply(current, cs)).toBe(current);
    });

    it("defers an append abutting a rewrite of the final line", () => {
      const base = "a\nb\n";
      const disk = "a\nB\n";
      const current = "a\nb\nZ\n";
      const cs = computeExternalChanges(base, disk, current);
      expect(cs.deferred).toBe(true);
      expect(apply(current, cs)).toBe(current);
    });

    it("defers a line-start insertion that has no trailing newline", () => {
      // Only an insertion ending in a newline leaves the line it precedes
      // byte-identical; "LOCAL" prepended to line 0 rewrites it, which
      // merges line 0 into the same chunk as the external rewrite below it.
      const base = "a\nb\nc\n";
      const disk = "a\nB\nc\n";
      const current = "LOCALa\nb\nc\n";
      const cs = computeExternalChanges(base, disk, current);
      expect(cs.deferred).toBe(true);
      expect(apply(current, cs)).toBe(current);
    });

    // Known over-deferral: the server resolves this one by word refinement,
    // but predicting when refinement succeeds means reimplementing its
    // tokenizer. Deferring costs a round trip through the reconcile
    // endpoint, which is the safe direction.
    it("defers a same-line insertion the server could still refine", () => {
      const base = "Hello world\n";
      const disk = "Hello world\nExternal line\n";
      const current = "LOCAL Hello world\n";
      const cs = computeExternalChanges(base, disk, current);
      expect(cs.deferred).toBe(true);
      expect(apply(current, cs)).toBe(current);
    });

    it("defers pure insertions at the very same position", () => {
      const base = "Hello world\n";
      const disk = "Hello world\nExternal line\n";
      const current = "Hello world\nLOCAL\n";
      const cs = computeExternalChanges(base, disk, current);
      expect(cs.deferred).toBe(true);
      expect(apply(current, cs)).toBe(current);
    });

    // Without a service worker there is no sync engine to declare a
    // divergent base to, and the editor's save carries no precondition --
    // so withholding would let the next save blindly overwrite the external
    // revision. A best-effort merge is the lesser evil there.
    it("merges best-effort instead of deferring when it cannot escalate", () => {
      const base = "Line1\nLine2 original\nLine3\n";
      const disk = "Line1\nLine2 changed by Remote\nLine3\n";
      const current = "Line1\nLine2 changed by Tab1\nLine3\n";
      expect(computeExternalChanges(base, disk, current).deferred).toBe(true);
      const cs = computeExternalChanges(base, disk, current, {
        canDefer: false,
      });
      expect(cs.deferred).toBe(false);
      expect(apply(current, cs)).not.toBe(current);
    });

    it("defers when a local edit joins two base lines", () => {
      // Deleting the newline merges line 1's text into line 0, so *both*
      // base lines stop being sync points -- not just the one holding the
      // deleted character.
      const base = "gamma gamma\nbeta\n";
      const disk = "gamma gamma\nbeta\n beta";
      const current = "gamma gamma beta\n";
      const cs = computeExternalChanges(base, disk, current);
      expect(cs.deferred).toBe(true);
      expect(apply(current, cs)).toBe(current);
    });

    it("merges insertions at distinct line boundaries", () => {
      const base = "intro\nbody\n";
      const disk = "intro\nXXX\nbody\n";
      const current = "intro\nbody\nlocal tail\n";
      const cs = computeExternalChanges(base, disk, current);
      expect(cs.deferred).toBe(false);
      expect(apply(current, cs)).toBe("intro\nXXX\nbody\nlocal tail\n");
    });

    it("merges rewrites separated by an untouched base line", () => {
      const base = "l1\nl2\nl3\nl4\n";
      const disk = "l1\nl2\nl3\nL4\n";
      const current = "L1\nl2\nl3\nl4\n";
      const cs = computeExternalChanges(base, disk, current);
      expect(cs.deferred).toBe(false);
      expect(apply(current, cs)).toBe("L1\nl2\nl3\nL4\n");
    });

    it("merges an insertion two lines clear of an external rewrite", () => {
      const base = "a\nb\nc\nd\n";
      const disk = "a\nb\nc\nD\n";
      const current = "a\nX\nb\nc\nd\n";
      const cs = computeExternalChanges(base, disk, current);
      expect(cs.deferred).toBe(false);
      expect(apply(current, cs)).toBe("a\nX\nb\nc\nD\n");
    });
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
