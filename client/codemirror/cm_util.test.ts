import { ChangeSet, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { diffAndPrepareChanges } from "./cm_util.ts";

function changesOf(oldString: string, newString: string) {
  const changes = ChangeSet.of(
    diffAndPrepareChanges(oldString, newString),
    oldString.length,
  );
  expect(changes.apply(Text.of(oldString.split("\n"))).toString()).toBe(
    newString,
  );
  const hunks: { from: number; to: number; inserted: string }[] = [];
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    hunks.push({ from, to, inserted: inserted.toString() });
  });
  return hunks;
}

describe("diffAndPrepareChanges", () => {
  it("inserts a new line whole when it shares a prefix with the next line", () => {
    const before = "* [ ] @ada write docs\n* [ ] @bob fix build\n";
    const after =
      "* [ ] @ada write docs\n* [ ] @cy review plan\n* [ ] @bob fix build\n";
    expect(changesOf(before, after)).toEqual([
      { from: 22, to: 22, inserted: "* [ ] @cy review plan\n" },
    ]);
  });

  it("deletes a line whole when it shares a prefix with the next line", () => {
    const before =
      "* [ ] @ada write docs\n* [ ] @cy review plan\n* [ ] @bob fix build\n";
    const after = "* [ ] @ada write docs\n* [ ] @bob fix build\n";
    expect(changesOf(before, after)).toEqual([
      { from: 22, to: 44, inserted: "" },
    ]);
  });

  it("keeps a line appended at the end of the document whole", () => {
    expect(changesOf("- one\n- two", "- one\n- two\n- three")).toEqual([
      { from: 11, to: 11, inserted: "\n- three" },
    ]);
  });

  it("keeps text intact when the edit slides at the document edges", () => {
    changesOf("- a\n", "- b\n- a\n");
    changesOf("- a\n- b\n", "- a\n");
    changesOf("a\na\na", "a\na\na\na");
    changesOf("xa\nb", "b");
  });

  it("stays linear on long repetitive runs", () => {
    const run = "a".repeat(200_000);
    expect(changesOf(run, `${run}a`)).toHaveLength(1);
  });

  it("leaves intra-line edits alone", () => {
    expect(changesOf("one two three", "one 2 three")).toEqual([
      { from: 4, to: 7, inserted: "2" },
    ]);
  });
});
