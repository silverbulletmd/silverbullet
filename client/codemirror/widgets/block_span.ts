// A run of whole lines that moves and deletes as one block: a widget's
// (fenced code, a table, an embed, a block `${…}`), from its ⋮ menu
// (`block_menu.ts`), or the text block a line is part of, from the line ⋮'s
// Delete (`textBlockAt`)
import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  type EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { blockDirectiveOnLine, ownsLines } from "./block_directive.ts";

/** A run of whole lines that moves and deletes as one block */
export type BlockSpan = { from: number; to: number };

/** The whole lines a node spans, as [start of first, end of last] */
function lineSpan(state: EditorState, n: { from: number; to: number }) {
  const { doc } = state;
  const last =
    n.to > n.from && doc.lineAt(n.to).from === n.to
      ? doc.lineAt(n.to - 1)
      : doc.lineAt(n.to);
  return { from: doc.lineAt(n.from).from, to: last.to };
}

/**
 * Whether `n` is the page's own document: not the root of a language nested
 * in it (the frontmatter's YAML has a `Document` too)
 */
const isPageRoot = (n: SyntaxNode | null): boolean =>
  !!n && n.name === "Document" && !n.parent;

/** The node holding `pos` whose parent is the document */
function topLevelNode(state: EditorState, pos: number): SyntaxNode | undefined {
  for (
    let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
    n;
    n = n.parent
  ) {
    if (isPageRoot(n.parent)) return n;
  }
}

/**
 * The block a widget whose source starts at `pos` stands for, if it is one: a
 * top-level node starting there (a fenced block, a table, a paragraph), or an
 * inline node starting there that has its lines to itself in a paragraph (an
 * embed, a `${…}`). Undefined for one sharing a line with text, or nested in
 * a list or quote.
 */
export function blockSpanAt(
  state: EditorState,
  pos: number,
): BlockSpan | undefined {
  for (
    let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
    n;
    n = n.parent
  ) {
    if (n.from !== pos) return;
    if (isPageRoot(n.parent)) return { from: n.from, to: n.to };
    if (n.parent?.name === "Paragraph" && isPageRoot(n.parent.parent)) {
      return ownsLines(state, n) ? { from: n.from, to: n.to } : undefined;
    }
  }
}

/** Blocks whose inner lines aren't text of their own: Delete on line 1 only */
const DELETE_FROM_FIRST_LINE = new Set(["FencedCode", "FrontMatter"]);

/**
 * The block of text `line` is part of, as whole lines, for the line ⋮'s
 * Delete: its list item (with its nested items) inside a list, else the
 * top-level block (a heading, a quote or callout, a table…). In a paragraph,
 * the run of text lines between block `${…}`s, which have their own menus. A
 * code block or frontmatter only from its first line. None on a blank line.
 */
export function textBlockAt(
  state: EditorState,
  line: number,
): BlockSpan | undefined {
  const target = state.doc.line(line);
  const text = target.text.trimStart();
  if (!text) return;
  const pos = target.to - text.length;
  for (
    let n: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
    n;
    n = n.parent
  ) {
    if (n.name === "ListItem") return lineSpan(state, n);
    if (!isPageRoot(n.parent)) continue;
    const span = lineSpan(state, n);
    if (n.name !== "Paragraph") {
      if (DELETE_FROM_FIRST_LINE.has(n.name) && span.from !== target.from) {
        return;
      }
      return span;
    }
    // A paragraph's text lines, up to its edges or a block `${…}`
    const within = (k: number) => {
      if (k < 1 || k > state.doc.lines) return false;
      const l = state.doc.line(k);
      return (
        l.from >= span.from &&
        l.to <= span.to &&
        !blockDirectiveOnLine(state, k)
      );
    };
    let first = line;
    let last = line;
    while (within(first - 1)) first--;
    while (within(last + 1)) last++;
    return { from: state.doc.line(first).from, to: state.doc.line(last).to };
  }
}

/**
 * What a block moves past, as whole lines. Inside a paragraph (text lines
 * right above or below it continue it): the next block `${…}` or the run of
 * text lines up to one. Otherwise, the block being whole top-level nodes: the
 * top-level block node (paragraph, list, heading line, table, code block…)
 * before or after it, blank lines between them skipped. None past
 * frontmatter, nor for a block nested in a list or quote.
 */
function neighbor(
  state: EditorState,
  span: BlockSpan,
  dir: -1 | 1,
): { from: number; to: number } | undefined {
  const { doc } = state;
  const self = lineSpan(state, span);
  const first = topLevelNode(state, span.from);
  const last = topLevelNode(state, Math.max(span.from, span.to - 1));
  if (!first || !last) return;
  if (first === last && first.name === "Paragraph") {
    const edge = lineSpan(state, first);
    if (dir < 0 ? self.from > edge.from : self.to < edge.to) {
      const near = doc.lineAt(dir < 0 ? self.from - 1 : self.to + 1);
      const other = blockDirectiveOnLine(state, near.number);
      if (other) return lineSpan(state, other.directive);
      // Text lines, up to the paragraph's edge or a block `${…}`
      let far = near;
      for (;;) {
        const n = far.number + dir;
        const next = n >= 1 && n <= doc.lines ? doc.line(n) : undefined;
        if (!next || next.from < edge.from || next.to > edge.to) break;
        if (blockDirectiveOnLine(state, n)) break;
        far = next;
      }
      return dir < 0
        ? { from: far.from, to: near.to }
        : { from: near.from, to: far.to };
    }
  }
  // Whole top-level nodes only: not part of a list, a quote or a code block
  if (
    self.from !== lineSpan(state, first).from ||
    self.to !== lineSpan(state, last).to
  ) {
    return;
  }
  const next = dir < 0 ? first.prevSibling : last.nextSibling;
  if (!next || next.name === "FrontMatter") return;
  return lineSpan(state, next);
}

/** Whether the block can move up (-1) or down (1) */
export function canMoveBlock(
  state: EditorState,
  span: BlockSpan,
  dir: -1 | 1,
): boolean {
  return !!neighbor(state, span, dir);
}

/**
 * Swaps the block with its neighboring block (see `neighbor`), the blank
 * lines between them staying where they are. A selection inside either moves
 * with it, so a `${…}` being edited stays open. Undefined when there is
 * nothing to move past.
 */
export function moveBlock(
  state: EditorState,
  span: BlockSpan,
  dir: -1 | 1,
): TransactionSpec | undefined {
  const near = neighbor(state, span, dir);
  if (!near) return;
  const self = lineSpan(state, span);
  const [first, second] = dir < 0 ? [near, self] : [self, near];
  const gap = state.sliceDoc(first.to, second.from);
  const firstText = state.sliceDoc(first.from, first.to);
  const secondText = state.sliceDoc(second.from, second.to);
  // Where each part's start lands
  const secondTo = first.from;
  const firstTo = first.from + secondText.length + gap.length;
  const map = (pos: number) => {
    if (pos >= first.from && pos <= first.to) return pos - first.from + firstTo;
    if (pos >= second.from && pos <= second.to) {
      return pos - second.from + secondTo;
    }
    return pos;
  };
  return {
    changes: {
      from: first.from,
      to: second.to,
      insert: secondText + gap + firstText,
    },
    selection: EditorSelection.create(
      state.selection.ranges.map((r) =>
        EditorSelection.range(map(r.anchor), map(r.head)),
      ),
      state.selection.mainIndex,
    ),
    scrollIntoView: true,
  };
}

/**
 * Deletes the block's lines, and one blank line beside them when it stood
 * between blank lines (or a blank line and the page's edge), so no double gap
 * is left
 */
export function deleteBlock(
  state: EditorState,
  block: BlockSpan,
): TransactionSpec {
  const { doc } = state;
  const span = lineSpan(state, block);
  const firstLine = doc.lineAt(span.from).number;
  const lastLine = doc.lineAt(span.to).number;
  const blank = (n: number) => doc.line(n).text.trim() === "";
  const blankBefore = firstLine > 1 && blank(firstLine - 1);
  const blankAfter = lastLine < doc.lines && blank(lastLine + 1);
  // The lines kept around it, after taking one of the blank lines
  let first = firstLine;
  let last = lastLine;
  if (blankAfter && (blankBefore || firstLine === 1)) last++;
  else if (blankBefore && lastLine === doc.lines) first--;
  // With a line break: the one after, else (at the end) the one before
  let from = doc.line(first).from;
  let to = doc.line(last).to;
  if (last < doc.lines) to += 1;
  else if (first > 1) from -= 1;
  return { changes: { from, to }, scrollIntoView: true };
}
