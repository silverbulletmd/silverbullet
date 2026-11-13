import { lineEnd, lineStart } from "@silverbulletmd/silverbullet/lib/lines";
import {
  addParentPointers,
  findParentMatching,
  nodeAtPos,
  type ParseTree,
  renderToText,
  traverseTree,
} from "@silverbulletmd/silverbullet/lib/tree";

/** The new text and where the selection (or cursor, `from === to`) went */
export type OutlineResult =
  | { text: string; from: number; to: number }
  | "blocked"
  | null;

export type ListContext = {
  type: "listItem";
  item: ParseTree;
  list: ParseTree; // BulletList or OrderedList
};

export type HeadingContext = {
  type: "heading";
  level: number;
  // Section: range of Document.children indices [start, end) for this heading section
  sectionStart: number; // index in Document.children
  sectionEnd: number; // exclusive index in Document.children
  doc: ParseTree;
};

export type ParagraphContext = {
  type: "paragraph";
  blockIndex: number; // index in Document.children
  doc: ParseTree;
};

export type TableRowContext = {
  type: "tableRow";
  row: ParseTree; // TableRow or TableHeader node
  isHeader: boolean; // true if cursor is on the TableHeader
  table: ParseTree;
};

export type CursorContext =
  | ListContext
  | HeadingContext
  | ParagraphContext
  | TableRowContext;

/**
 * Classifies the cursor position as a listItem, heading, tableRow, or
 * paragraph context for outline operations. At node boundaries, resolves to
 * the preceding typed node (drilling into nested children). A cursor placed
 * just after the last character of a document with no trailing newline is
 * included.
 * Returns null for positions where no outline operation applies (code blocks,
 * frontmatter, past end of document).
 */
export function detectContext(
  tree: ParseTree,
  cursor: number,
): CursorContext | null {
  addParentPointers(tree);
  let initial = nodeAtPos(tree, cursor);
  // nodeAtPos uses a half-open range, so a cursor after the final character
  // (`pos === tree.to`, typical when the file has no trailing newline) is
  // outside every node and outline commands no-op. Step back onto that
  // character. A file that does end in a newline still falls through the
  // boundary walk below and stays a no-op when the cursor is past the last
  // block.
  if (!initial && cursor > 0 && cursor === tree.to) {
    initial = nodeAtPos(tree, cursor - 1);
  }
  if (!initial) {
    return null;
  }

  // When cursor is on a separator between typed children (nodeAtPos returns
  // a container like Document, BulletList, or ListItem), check if it's right
  // at the end of a preceding typed child — if so, drill into that child.
  // Repeat recursively so we reach the deepest matching node (e.g. a nested
  // ListItem rather than its parent). This handles cursor-at-end-of-line.
  let node: ParseTree = initial;
  while (node.children) {
    let found: ParseTree | null = null;
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (child.type && child.to === cursor) {
        found = child;
        break;
      }
    }
    if (!found) {
      break;
    }
    node = found;
  }

  // If nodeAtPos landed on a BulletList/OrderedList itself (i.e. on separator
  // whitespace between items), don't walk up — cursor isn't on any item.
  const listItem =
    node.type === "ListItem"
      ? node
      : node.type === "BulletList" || node.type === "OrderedList"
        ? null
        : findParentMatching(node, (n) => n.type === "ListItem");
  if (listItem) {
    const list = listItem.parent;
    if (list && (list.type === "BulletList" || list.type === "OrderedList")) {
      return { type: "listItem", item: listItem, list };
    }
  }

  const heading = node.type?.startsWith("ATXHeading")
    ? node
    : findParentMatching(
        node,
        (n) => n.type?.startsWith("ATXHeading") ?? false,
      );
  if (heading?.type) {
    const level = parseInt(heading.type.replace("ATXHeading", ""), 10);
    const doc = heading.parent!;
    if (doc.type === "Document" && doc.children) {
      const headingIndex = doc.children.indexOf(heading);
      const sectionStart = headingIndex;
      let sectionEnd = doc.children.length;
      for (let i = headingIndex + 1; i < doc.children.length; i++) {
        const child = doc.children[i];
        if (child.type?.startsWith("ATXHeading")) {
          const childLevel = parseInt(child.type.replace("ATXHeading", ""), 10);
          if (childLevel <= level) {
            sectionEnd = i;
            break;
          }
        }
      }
      return { type: "heading", level, sectionStart, sectionEnd, doc };
    }
  }

  const tableRow =
    node.type === "TableRow" || node.type === "TableHeader"
      ? node
      : findParentMatching(
          node,
          (n) => n.type === "TableRow" || n.type === "TableHeader",
        );
  if (tableRow && tableRow.parent?.type === "Table") {
    const table = tableRow.parent;
    const isHeader = tableRow.type === "TableHeader";
    return { type: "tableRow", row: tableRow, isHeader, table };
  }

  const para =
    node.type === "Paragraph"
      ? node
      : findParentMatching(node, (n) => n.type === "Paragraph");
  if (para && para.parent?.type === "Document") {
    const doc = para.parent;
    const blockIndex = doc.children!.indexOf(para);
    return { type: "paragraph", blockIndex, doc };
  }

  return null;
}

/**
 * CommonMark starts a new BulletList whenever the marker character changes
 * (e.g. a `-` item followed by a `*` item), even with no blank line between
 * them. For outline operations we want to treat such runs of adjacent
 * BulletLists as a single logical list so items can move across the marker
 * boundary. Returns the sequence of BulletList siblings that are separated
 * from `list` only by whitespace text nodes in the shared parent. OrderedLists
 * and other block types break the run.
 */
function adjacentBulletListGroup(list: ParseTree): ParseTree[] {
  if (list.type !== "BulletList") {
    return [list];
  }
  const parent = list.parent;
  if (!parent?.children) {
    return [list];
  }
  const siblings = parent.children;
  const idx = siblings.indexOf(list);
  const group: ParseTree[] = [list];

  for (let i = idx - 1; i >= 0; i--) {
    const s = siblings[i];
    if (!s.type) continue; // separator text nodes
    if (s.type === "BulletList") {
      group.unshift(s);
    } else {
      break;
    }
  }
  for (let i = idx + 1; i < siblings.length; i++) {
    const s = siblings[i];
    if (!s.type) continue;
    if (s.type === "BulletList") {
      group.push(s);
    } else {
      break;
    }
  }
  return group;
}

/**
 * Returns all ListItem nodes from `list` and any adjacent BulletList siblings
 * (see `adjacentBulletListGroup`), in document order.
 */
function combinedListItems(list: ParseTree): ParseTree[] {
  const items: ParseTree[] = [];
  for (const l of adjacentBulletListGroup(list)) {
    if (!l.children) continue;
    for (const c of l.children) {
      if (c.type === "ListItem") {
        items.push(c);
      }
    }
  }
  return items;
}

type Span = Pick<ParseTree, "from" | "to">;

/**
 * Swaps the `curr` text region with the non-overlapping `other` one,
 * preserving the separator between them and moving the selection
 * `[from, to]` along with `curr` (collapsed to `from` when it reaches past
 * `curr`, which the swap would tear apart).
 */
function swapRegions(
  text: string,
  curr: Span,
  other: Span,
  from: number,
  to: number,
): { text: string; from: number; to: number } {
  if (to > curr.to!) to = from;
  const up = other.from! < curr.from!;
  const [first, second] = up ? [other, curr] : [curr, other];
  const firstContent = text.slice(first.from, first.to);
  const separator = text.slice(first.to, second.from);
  const secondContent = text.slice(second.from, second.to);
  const newText =
    text.slice(0, first.from) +
    secondContent +
    separator +
    firstContent +
    text.slice(second.to);
  const shift = up
    ? other.from! - curr.from!
    : secondContent.length + separator.length;
  return { text: newText, from: from + shift, to: to + shift };
}

/**
 * Renumbers all ordered list markers (1., 2., ...) sequentially within the
 * given range.
 */
function renumberOrderedList(
  text: string,
  listFrom: number,
  listTo: number,
): string {
  const listText = text.slice(listFrom, listTo);
  let num = 1;
  const renumbered = listText.replace(/^(\s*)(\d+)\./gm, (_match, indent) => {
    return `${indent}${num++}.`;
  });
  return text.slice(0, listFrom) + renumbered + text.slice(listTo);
}

/**
 * What an op at `[from, to]` applies to: with a selection, the list items it
 * touches (see `itemsInRange`); else, or when it touches none, the context at
 * `from`, a list item there becoming a one-item run.
 */
function opTarget(
  text: string,
  tree: ParseTree,
  from: number,
  to: number,
): ParseTree[] | Exclude<CursorContext, ListContext> | null {
  if (from !== to) {
    const items = itemsInRange(text, tree, from, to);
    if (items.length) return items;
  }
  const ctx = detectContext(tree, from);
  return ctx?.type === "listItem" ? [ctx.item] : ctx;
}

export type OutlineOp = (
  text: string,
  tree: ParseTree,
  from: number,
  to?: number,
) => OutlineResult;

/**
 * Moves the outline element at `[from, to]` up or down: the selected list
 * items together (they must be one run of siblings), else the heading section,
 * paragraph or table row at `from`.
 */
function move(
  text: string,
  tree: ParseTree,
  from: number,
  to: number,
  direction: "up" | "down",
): OutlineResult {
  const target = opTarget(text, tree, from, to);
  if (!target) return null;
  if (Array.isArray(target)) {
    return moveListRun(text, target, from, to, direction);
  }
  switch (target.type) {
    case "heading":
      return moveHeading(text, from, to, target, direction) ?? "blocked";
    case "paragraph":
      return moveParagraph(text, from, to, target, direction) ?? "blocked";
    case "tableRow":
      return moveTableRow(text, from, to, target, direction) ?? "blocked";
  }
}

export const moveUp: OutlineOp = (text, tree, from, to = from) =>
  move(text, tree, from, to, "up");
export const moveDown: OutlineOp = (text, tree, from, to = from) =>
  move(text, tree, from, to, "down");

/**
 * Indents or outdents the outline element at `[from, to]`: every selected
 * list item with its children (all or nothing), else the heading section at
 * `from`.
 */
function adjustLevel(
  text: string,
  tree: ParseTree,
  from: number,
  to: number,
  delta: 1 | -1,
): OutlineResult {
  const target = opTarget(text, tree, from, to);
  if (!target) return null;
  if (Array.isArray(target)) {
    return adjustListLevel(text, target, from, to, delta);
  }
  if (target.type === "heading") {
    return adjustHeadingLevel(text, from, target, delta) ?? "blocked";
  }
  return "blocked";
}

export const indent: OutlineOp = (text, tree, from, to = from) =>
  adjustLevel(text, tree, from, to, 1);
export const outdent: OutlineOp = (text, tree, from, to = from) =>
  adjustLevel(text, tree, from, to, -1);

/**
 * Swaps a run of sibling list items with the item before (up) or after
 * (down) it, renumbering an ordered list; null when there's none or the items
 * aren't one run.
 */
function moveListRun(
  text: string,
  run: ParseTree[],
  from: number,
  to: number,
  direction: "up" | "down",
): OutlineResult {
  const list = run[0].parent!;
  const items = combinedListItems(list);
  const start = items.indexOf(run[0]);
  if (start < 0 || run.some((item, i) => items[start + i] !== item)) {
    return "blocked";
  }
  const other = items[direction === "up" ? start - 1 : start + run.length];
  if (!other) return "blocked";
  const runFrom = run[0].from!;
  const runTo = run[run.length - 1].to!;
  // A selection may start in the first line's indentation: keep it there
  const lineFrom = lineStart(text, runFrom);
  const clamp = (pos: number) => Math.min(Math.max(pos, lineFrom), runTo);
  const result = swapRegions(
    text,
    { from: runFrom, to: runTo },
    other,
    clamp(from),
    clamp(to),
  );
  return list.type === "OrderedList"
    ? {
        ...result,
        text: renumberOrderedList(result.text, list.from!, list.to!),
      }
    : result;
}

/**
 * Returns the indent width for a list (2 for bullet, marker length + 1 for
 * ordered).
 */
function listIndentWidth(list: ParseTree): number {
  if (list.type === "BulletList") {
    return 2;
  }
  const firstItem = list.children?.find((c) => c.type === "ListItem");
  if (firstItem) {
    const mark = firstItem.children?.find((c) => c.type === "ListMark");
    if (mark) {
      return renderToText(mark).length + 1;
    }
  }
  return 3;
}

// Nested items count too, which collectNodesMatching (stops at a match) skips
function collectListItems(tree: ParseTree): ParseTree[] {
  const items: ParseTree[] = [];
  traverseTree(tree, (node) => {
    if (node.type === "ListItem") items.push(node);
    return false;
  });
  return items;
}

/**
 * The list items whose first line the range `[from, to]` touches, in
 * document order, leaving out those inside another of them (they go along
 * with it). A range ending at the start of a line leaves that line out.
 */
function itemsInRange(
  text: string,
  tree: ParseTree,
  from: number,
  to: number,
): ParseTree[] {
  addParentPointers(tree);
  const end = to > from && text[to - 1] === "\n" ? to - 1 : to;
  const touched = collectListItems(tree).filter((item) => {
    return (
      lineStart(text, item.from!) <= end && lineEnd(text, item.from!) >= from
    );
  });
  const touchedSet = new Set(touched);
  const inside = (item: ParseTree) => {
    for (let p = item.parent; p; p = p.parent) {
      if (touchedSet.has(p)) return true;
    }
    return false;
  };
  return touched.filter((item) => !inside(item));
}

type LineEdit = { at: number; insert: string; remove: number };

/**
 * Indents (`delta` 1) or outdents (-1) list items with their children by one
 * level; blocked as a whole when one of them can't go. An item can indent
 * when it has a preceding sibling (possibly in an adjacent BulletList with a
 * different marker) or its list is already nested.
 */
function adjustListLevel(
  text: string,
  items: ParseTree[],
  from: number,
  to: number,
  delta: 1 | -1,
): OutlineResult {
  const edits: LineEdit[] = [];
  for (const item of items) {
    const list = item.parent!;
    const indentWidth = listIndentWidth(list);
    const lineFrom = lineStart(text, item.from!);
    const lines = text.slice(lineFrom, item.to!).split("\n");
    if (delta === 1) {
      const isNested = list.parent?.type === "ListItem";
      if (combinedListItems(list).indexOf(item) <= 0 && !isNested) {
        return "blocked";
      }
    } else if (!lines[0].startsWith("  ")) {
      return "blocked";
    }
    let at = lineFrom;
    for (const line of lines) {
      if (delta === 1 && line) {
        edits.push({ at, insert: " ".repeat(indentWidth), remove: 0 });
      } else if (delta === -1) {
        const remove = Math.min(indentWidth, line.match(/^ */)![0].length);
        if (remove) edits.push({ at, insert: "", remove });
      }
      at += line.length + 1;
    }
  }
  return applyEdits(text, edits, from, to);
}

/** Applies non-overlapping edits, mapping the selection through them */
function applyEdits(
  text: string,
  edits: LineEdit[],
  from: number,
  to: number,
): { text: string; from: number; to: number } {
  const sorted = [...edits].sort((a, b) => a.at - b.at);
  // `side` -1: stays before an insertion at its position (a selection
  // starting at a line start takes in the line's new indentation; a cursor
  // moves along with the text)
  const map = (pos: number, side: 1 | -1) => {
    let shift = 0;
    for (const edit of sorted) {
      if (edit.at > pos || (edit.at === pos && side === -1 && edit.insert)) {
        break;
      }
      shift += edit.insert.length;
      shift -= Math.min(edit.remove, pos - edit.at);
    }
    return pos + shift;
  };
  let out = "";
  let last = 0;
  for (const edit of sorted) {
    out += text.slice(last, edit.at) + edit.insert;
    last = edit.at + edit.remove;
  }
  out += text.slice(last);
  return { text: out, from: map(from, from === to ? 1 : -1), to: map(to, 1) };
}

/**
 * Returns the end position of the last typed child in a range, excluding
 * trailing separator newlines.
 */
function lastTypedChildEnd(
  children: ParseTree[],
  start: number,
  end: number,
): number {
  for (let i = end - 1; i >= start; i--) {
    if (children[i].type) {
      return children[i].to!;
    }
  }
  return children[start].from!;
}

/**
 * Swaps a heading section (including sub-headings and body) with its adjacent
 * sibling section.
 */
function moveHeading(
  text: string,
  from: number,
  to: number,
  ctx: HeadingContext,
  direction: "up" | "down",
): OutlineResult {
  const { level, sectionStart, sectionEnd, doc } = ctx;
  const children = doc.children!;

  const searchFrom = direction === "up" ? sectionStart - 1 : sectionEnd;
  const searchTo = direction === "up" ? -1 : children.length;
  const step = direction === "up" ? -1 : 1;

  let adjSectionStart = -1;
  for (let i = searchFrom; i !== searchTo; i += step) {
    const child = children[i];
    if (child.type?.startsWith("ATXHeading")) {
      const childLevel = parseInt(child.type.replace("ATXHeading", ""), 10);
      if (childLevel === level) {
        adjSectionStart = i;
        break;
      }
      if (childLevel < level) {
        return null;
      }
    }
  }
  if (adjSectionStart < 0) {
    return null;
  }

  let adjSectionEnd: number;
  if (direction === "up") {
    adjSectionEnd = sectionStart;
  } else {
    adjSectionEnd = children.length;
    for (let i = adjSectionStart + 1; i < children.length; i++) {
      const child = children[i];
      if (child.type?.startsWith("ATXHeading")) {
        const childLevel = parseInt(child.type.replace("ATXHeading", ""), 10);
        if (childLevel <= level) {
          adjSectionEnd = i;
          break;
        }
      }
    }
  }

  const section = (start: number, end: number) => ({
    from: children[start].from,
    to: lastTypedChildEnd(children, start, end),
  });
  return swapRegions(
    text,
    section(sectionStart, sectionEnd),
    section(adjSectionStart, adjSectionEnd),
    from,
    to,
  );
}

/**
 * Adds or removes a '#' from all headings in a section, clamping at h1/h6.
 */
function adjustHeadingLevel(
  text: string,
  cursor: number,
  ctx: HeadingContext,
  delta: 1 | -1,
): OutlineResult {
  const { level, sectionStart, sectionEnd, doc } = ctx;
  if (delta === 1 && level >= 6) {
    return null;
  }
  if (delta === -1 && level <= 1) {
    return null;
  }

  const limitLevel = delta === 1 ? 6 : 1;
  const children = doc.children!;
  const sectionFrom = children[sectionStart].from!;
  const sectionTo = children[sectionEnd - 1].to!;
  const sectionText = text.slice(sectionFrom, sectionTo);

  let cursorAdjust = 0;
  let newSectionText = "";
  let pos = 0;
  for (let i = sectionStart; i < sectionEnd; i++) {
    const child = children[i];
    if (child.type?.startsWith("ATXHeading")) {
      const childLevel = parseInt(child.type.replace("ATXHeading", ""), 10);
      if (childLevel === limitLevel) {
        continue;
      }

      const childFrom = child.from! - sectionFrom;
      const childTo = child.to! - sectionFrom;

      newSectionText += sectionText.slice(pos, childFrom);
      if (delta === 1) {
        newSectionText += `#${sectionText.slice(childFrom, childTo)}`;
      } else {
        newSectionText += sectionText.slice(childFrom + 1, childTo);
      }
      pos = childTo;

      if (cursor > child.from!) {
        cursorAdjust += delta;
      }
    }
  }
  newSectionText += sectionText.slice(pos);

  const newText =
    text.slice(0, sectionFrom) + newSectionText + text.slice(sectionTo);
  const newCursor = cursor + cursorAdjust;
  return { text: newText, from: newCursor, to: newCursor };
}

/**
 * Swaps a table data row with the adjacent data row. Header rows are blocked.
 */
function moveTableRow(
  text: string,
  from: number,
  to: number,
  ctx: TableRowContext,
  direction: "up" | "down",
): OutlineResult {
  if (ctx.isHeader) {
    return null;
  }

  const { row, table } = ctx;
  const rows = table.children!.filter((c) => c.type === "TableRow");
  const otherRow = rows[rows.indexOf(row) + (direction === "up" ? -1 : 1)];
  return otherRow ? swapRegions(text, row, otherRow, from, to) : null;
}

/**
 * Swaps a top-level paragraph with the adjacent document-level block.
 */
function moveParagraph(
  text: string,
  from: number,
  to: number,
  ctx: ParagraphContext,
  direction: "up" | "down",
): OutlineResult {
  const { blockIndex, doc } = ctx;
  const children = doc.children!;
  const currNode = children[blockIndex];

  let adjIdx = blockIndex + (direction === "up" ? -1 : 1);
  const step = direction === "up" ? -1 : 1;
  while (adjIdx >= 0 && adjIdx < children.length && !children[adjIdx].type) {
    adjIdx += step;
  }
  if (adjIdx < 0 || adjIdx >= children.length) {
    return null;
  }

  return swapRegions(text, currNode, children[adjIdx], from, to);
}
