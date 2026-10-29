import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type FrontmatterBlock = {
  from: number;
  to: number;
};

// Parsing only up to the closing fence is enough to find the block, even
// while the rest of a long page hasn't been parsed yet
function frontmatterParseUpto(state: EditorState): number {
  const firstLine = state.doc.line(1);
  if (firstLine.text.trimEnd() !== "---") {
    return firstLine.to;
  }
  for (let lineNumber = 2; lineNumber <= state.doc.lines; lineNumber++) {
    const line = state.doc.line(lineNumber);
    if (line.text.trimEnd() === "---") {
      return line.to;
    }
  }
  return state.doc.length;
}

/** The page's frontmatter, fences included */
export function findFrontmatterBlock(
  state: EditorState,
): FrontmatterBlock | undefined {
  let block: FrontmatterBlock | undefined;
  const tree =
    ensureSyntaxTree(state, frontmatterParseUpto(state)) ?? syntaxTree(state);
  tree.iterate({
    enter(node) {
      if (node.name !== "FrontMatter") return;
      block = { from: node.from, to: node.to };
      return false;
    },
  });
  return block;
}

/** Whether a selection range overlaps the half-open range `from`–`to` */
export function selectionIntersectsRange(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  return state.selection.ranges.some((range) => {
    if (range.empty) {
      return range.from >= from && range.from < to;
    }
    return range.from < to && range.to > from;
  });
}
