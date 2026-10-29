import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { buildExtendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import {
  findFrontmatterBlock,
  selectionIntersectsRange,
} from "./frontmatter_block.ts";

function stateWithDoc(doc: string, selection = 0) {
  return EditorState.create({
    doc,
    selection: { anchor: selection },
    extensions: [buildExtendedMarkdownLanguage()],
  });
}

describe("frontmatter block", () => {
  test("finds the top frontmatter block, fences included", () => {
    const state = stateWithDoc("---\na: 1\nb: 2\n---\nBody");

    expect(findFrontmatterBlock(state)).toEqual({ from: 0, to: 17 });
  });

  test("does not find malformed frontmatter", () => {
    const state = stateWithDoc("---\na: 1\nBody");

    expect(findFrontmatterBlock(state)).toBeUndefined();
  });

  test("detects selections intersecting the frontmatter range", () => {
    const state = stateWithDoc("---\na: 1\n---\nBody", 5);
    expect(selectionIntersectsRange(state, 0, 12)).toBe(true);
    expect(selectionIntersectsRange(state, 13, 17)).toBe(false);
  });

  test("uses half-open range boundaries for cursors", () => {
    expect(selectionIntersectsRange(stateWithDoc("abcdef", 1), 1, 4)).toBe(
      true,
    );
    expect(selectionIntersectsRange(stateWithDoc("abcdef", 3), 1, 4)).toBe(
      true,
    );
    expect(selectionIntersectsRange(stateWithDoc("abcdef", 4), 1, 4)).toBe(
      false,
    );
  });

  test("uses half-open range boundaries for non-empty selections", () => {
    const selectionEndingAtFrom = EditorState.create({
      doc: "abcdef",
      selection: { anchor: 0, head: 1 },
    });
    const selectionStartingAtTo = EditorState.create({
      doc: "abcdef",
      selection: { anchor: 4, head: 5 },
    });
    const selectionOverlappingRange = EditorState.create({
      doc: "abcdef",
      selection: { anchor: 3, head: 5 },
    });

    expect(selectionIntersectsRange(selectionEndingAtFrom, 1, 4)).toBe(false);
    expect(selectionIntersectsRange(selectionStartingAtTo, 1, 4)).toBe(false);
    expect(selectionIntersectsRange(selectionOverlappingRange, 1, 4)).toBe(
      true,
    );
  });
});
