import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import {
  addParentPointers,
  findParentMatching,
  nodeAtPos,
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";

export type OutlineResult =
  | { text: string; cursor: number }
  | "blocked"
  | null;

export type ListContext = {
  type: "listItem";
  item: ParseTree;
  itemIndex: number; // index in parent.children (includes separator text nodes)
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
  rowIndex: number; // index in Table.children
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
 * the preceding typed node (drilling into nested children). Returns null for
 * positions where no outline operation applies (code blocks, frontmatter,
 * past end of document).
 */
export function detectContext(
  tree: ParseTree,
  cursor: number,
): CursorContext | null {
  addParentPointers(tree);
  const initial = nodeAtPos(tree, cursor);
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

  // Check if we're in a list item
  // If nodeAtPos landed on a BulletList/OrderedList itself (i.e. on separator
  // whitespace between items), don't walk up — cursor isn't on any item.
  const listItem = node.type === "ListItem"
    ? node
    : (node.type === "BulletList" || node.type === "OrderedList")
    ? null
    : findParentMatching(node, (n) => n.type === "ListItem");
  if (listItem) {
    const list = listItem.parent;
    if (
      list &&
      (list.type === "BulletList" || list.type === "OrderedList")
    ) {
      const itemIndex = list.children!.indexOf(listItem);
      return { type: "listItem", item: listItem, itemIndex, list };
    }
  }

  // Check if we're in a heading
  const heading = node.type?.startsWith("ATXHeading")
    ? node
    : findParentMatching(
      node,
      (n) => n.type?.startsWith("ATXHeading") ?? false,
    );
  if (heading && heading.type) {
    const level = parseInt(heading.type.replace("ATXHeading", ""));
    const doc = heading.parent!;
    if (doc.type === "Document" && doc.children) {
      const headingIndex = doc.children.indexOf(heading);
      const sectionStart = headingIndex;
      let sectionEnd = doc.children.length;
      for (let i = headingIndex + 1; i < doc.children.length; i++) {
        const child = doc.children[i];
        if (child.type?.startsWith("ATXHeading")) {
          const childLevel = parseInt(
            child.type.replace("ATXHeading", ""),
          );
          if (childLevel <= level) {
            sectionEnd = i;
            break;
          }
        }
      }
      return { type: "heading", level, sectionStart, sectionEnd, doc };
    }
  }

  // Check if we're in a table row or header
  const tableRow = node.type === "TableRow" || node.type === "TableHeader"
    ? node
    : findParentMatching(
      node,
      (n) => n.type === "TableRow" || n.type === "TableHeader",
    );
  if (tableRow && tableRow.parent?.type === "Table") {
    const table = tableRow.parent;
    const rowIndex = table.children!.indexOf(tableRow);
    const isHeader = tableRow.type === "TableHeader";
    return { type: "tableRow", row: tableRow, rowIndex, isHeader, table };
  }

  // Check if we're in a paragraph at the Document level
  const para = node.type === "Paragraph"
    ? node
    : findParentMatching(node, (n) => n.type === "Paragraph");
  if (para && para.parent?.type === "Document") {
    const doc = para.parent;
    const blockIndex = doc.children!.indexOf(para);
    return { type: "paragraph", blockIndex, doc };
  }

  // No context we can do something with
  return null;
}

/**
 * Returns indices of ListItem children in list.children, skipping separator text nodes.
 */
function listItemIndices(list: ParseTree): number[] {
  const indices: number[] = [];
  if (!list.children) {
    return indices;
  }
  for (let i = 0; i < list.children.length; i++) {
    if (list.children[i].type === "ListItem") {
      indices.push(i);
    }
  }
  return indices;
}

/**
 * Swaps two non-overlapping text regions, preserving the separator between
 * them and adjusting the cursor position based on move direction.
 */
function swapRegions(
  text: string,
  cursor: number,
  currFrom: number,
  direction: "up" | "down",
  firstFrom: number,
  firstTo: number,
  secondFrom: number,
  secondTo: number,
): { text: string; cursor: number } {
  const firstContent = text.slice(firstFrom, firstTo);
  const separator = text.slice(firstTo, secondFrom);
  const secondContent = text.slice(secondFrom, secondTo);
  const newText = text.slice(0, firstFrom) + secondContent + separator +
    firstContent + text.slice(secondTo);
  const offsetInCurr = cursor - currFrom;
  const newCursor = direction === "up"
    ? firstFrom + offsetInCurr
    : firstFrom + secondContent.length + separator.length + offsetInCurr;
  return { text: newText, cursor: newCursor };
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
  const renumbered = listText.replace(
    /^(\s*)(\d+)\./gm,
    (_match, indent) => {
      return `${indent}${num++}.`;
    },
  );
  return text.slice(0, listFrom) + renumbered + text.slice(listTo);
}

/**
 * Moves the outline element at cursor up or down, dispatching to the
 * appropriate handler.
 */
function move(
  text: string,
  cursor: number,
  direction: "up" | "down",
): OutlineResult {
  const tree = parseMarkdown(text);
  const ctx = detectContext(tree, cursor);
  if (!ctx) {
    return null;
  }
  switch (ctx.type) {
    case "listItem":
      return moveListItem(text, cursor, ctx, direction) ?? "blocked";
    case "heading":
      return moveHeading(text, cursor, ctx, direction) ?? "blocked";
    case "paragraph":
      return moveParagraph(text, cursor, ctx, direction) ?? "blocked";
    case "tableRow":
      return moveTableRow(text, cursor, ctx, direction) ?? "blocked";
  }
}

export const moveUp = (text: string, cursor: number) =>
  move(text, cursor, "up");
export const moveDown = (text: string, cursor: number) =>
  move(text, cursor, "down");

/**
 * Indents or outdents the outline element at cursor, dispatching to the
 * appropriate handler.
 */
function adjustLevel(
  text: string,
  cursor: number,
  delta: 1 | -1,
): OutlineResult {
  const tree = parseMarkdown(text);
  const ctx = detectContext(tree, cursor);
  if (!ctx) {
    return null;
  }
  switch (ctx.type) {
    case "listItem":
      return (delta === 1
        ? indentListItem(text, cursor, ctx)
        : outdentListItem(text, cursor, ctx)) ?? "blocked";
    case "heading":
      return adjustHeadingLevel(text, cursor, ctx, delta) ?? "blocked";
    case "paragraph":
    case "tableRow":
      return "blocked";
  }
}

export const indent = (text: string, cursor: number) =>
  adjustLevel(text, cursor, 1);
export const outdent = (text: string, cursor: number) =>
  adjustLevel(text, cursor, -1);

/**
 * Swaps a list item with its adjacent sibling, renumbering if in an ordered
 * list.
 */
function moveListItem(
  text: string,
  cursor: number,
  ctx: ListContext,
  direction: "up" | "down",
): OutlineResult {
  const { item, list } = ctx;
  const indices = listItemIndices(list);
  const itemPos = indices.indexOf(ctx.itemIndex);

  if (direction === "up" && itemPos <= 0) {
    return null;
  }
  if (direction === "down" && itemPos >= indices.length - 1) {
    return null;
  }

  const otherPos = direction === "up" ? itemPos - 1 : itemPos + 1;
  const otherIndex = indices[otherPos];
  const otherItem = list.children![otherIndex];

  const first = direction === "up" ? otherItem : item;
  const second = direction === "up" ? item : otherItem;

  const result = swapRegions(
    text,
    cursor,
    item.from!,
    direction,
    first.from!,
    first.to!,
    second.from!,
    second.to!,
  );

  if (list.type === "OrderedList") {
    return {
      text: renumberOrderedList(result.text, list.from!, list.to!),
      cursor: result.cursor,
    };
  }

  return result;
}

/**
 * Returns the start of the line containing position `pos`.
 */
function lineStartPos(text: string, pos: number): number {
  let start = pos;
  while (start > 0 && text[start - 1] !== "\n") {
    start--;
  }
  return start;
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

/**
 * Adds one level of indentation to a list item and its children.
 */
function indentListItem(
  text: string,
  cursor: number,
  ctx: ListContext,
): OutlineResult {
  const { item, list } = ctx;
  const indices = listItemIndices(list);
  const itemPos = indices.indexOf(ctx.itemIndex);

  // Can indent if: has preceding sibling, or list is already nested
  const isNested = list.parent?.type === "ListItem";
  if (itemPos <= 0 && !isNested) {
    return null;
  }

  const indentWidth = listIndentWidth(list);
  const indentStr = " ".repeat(indentWidth);

  // Work with full lines including leading whitespace
  const lineFrom = lineStartPos(text, item.from!);
  const lineTo = item.to!;
  const itemLines = text.slice(lineFrom, lineTo);

  const indented = itemLines.split("\n").map((line) =>
    line ? indentStr + line : line
  ).join("\n");

  const newText = text.slice(0, lineFrom) + indented + text.slice(lineTo);

  const preText = text.slice(lineFrom, cursor);
  const linesBeforeCursor = preText.split("\n").length;
  const newCursor = cursor + linesBeforeCursor * indentWidth;

  return { text: newText, cursor: newCursor };
}

/**
 * Removes one level of indentation from a list item and its children.
 */
function outdentListItem(
  text: string,
  cursor: number,
  ctx: ListContext,
): OutlineResult {
  const { item, list } = ctx;

  const lineFrom = lineStartPos(text, item.from!);
  const lineTo = item.to!;
  const itemLines = text.slice(lineFrom, lineTo);

  if (!itemLines.startsWith("  ")) {
    return null;
  }

  const indentWidth = listIndentWidth(list);

  const outdented = itemLines.split("\n").map((line) => {
    if (line.startsWith(" ".repeat(indentWidth))) {
      return line.substring(indentWidth);
    }
    let removed = 0;
    while (removed < indentWidth && line[removed] === " ") {
      removed++;
    }
    return line.substring(removed);
  }).join("\n");

  const newText = text.slice(0, lineFrom) + outdented + text.slice(lineTo);

  const preText = text.slice(lineFrom, cursor);
  const linesBeforeCursor = preText.split("\n").length;
  const newCursor = cursor - linesBeforeCursor * indentWidth;

  return { text: newText, cursor: newCursor };
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
  cursor: number,
  ctx: HeadingContext,
  direction: "up" | "down",
): OutlineResult {
  const { level, sectionStart, sectionEnd, doc } = ctx;
  const children = doc.children!;

  // Find adjacent section at the same level
  const searchFrom = direction === "up" ? sectionStart - 1 : sectionEnd;
  const searchTo = direction === "up" ? -1 : children.length;
  const step = direction === "up" ? -1 : 1;

  let adjSectionStart = -1;
  for (let i = searchFrom; i !== searchTo; i += step) {
    const child = children[i];
    if (child.type?.startsWith("ATXHeading")) {
      const childLevel = parseInt(child.type.replace("ATXHeading", ""));
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

  // Find end of adjacent section
  let adjSectionEnd: number;
  if (direction === "up") {
    adjSectionEnd = sectionStart;
  } else {
    adjSectionEnd = children.length;
    for (let i = adjSectionStart + 1; i < children.length; i++) {
      const child = children[i];
      if (child.type?.startsWith("ATXHeading")) {
        const childLevel = parseInt(child.type.replace("ATXHeading", ""));
        if (childLevel <= level) {
          adjSectionEnd = i;
          break;
        }
      }
    }
  }

  // Normalize to [first, second] order
  const [firstStart, firstEnd, secondStart, secondEnd] = direction === "up"
    ? [adjSectionStart, adjSectionEnd, sectionStart, sectionEnd]
    : [sectionStart, sectionEnd, adjSectionStart, adjSectionEnd];

  return swapRegions(
    text,
    cursor,
    children[sectionStart].from!,
    direction,
    children[firstStart].from!,
    lastTypedChildEnd(children, firstStart, firstEnd),
    children[secondStart].from!,
    lastTypedChildEnd(children, secondStart, secondEnd),
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
      const childLevel = parseInt(child.type.replace("ATXHeading", ""));
      if (childLevel === limitLevel) {
        continue;
      }

      const childFrom = child.from! - sectionFrom;
      const childTo = child.to! - sectionFrom;

      newSectionText += sectionText.slice(pos, childFrom);
      if (delta === 1) {
        newSectionText += "#" + sectionText.slice(childFrom, childTo);
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

  const newText = text.slice(0, sectionFrom) + newSectionText +
    text.slice(sectionTo);
  return { text: newText, cursor: cursor + cursorAdjust };
}

/**
 * Swaps a table data row with the adjacent data row. Header rows are blocked.
 */
function moveTableRow(
  text: string,
  cursor: number,
  ctx: TableRowContext,
  direction: "up" | "down",
): OutlineResult {
  if (ctx.isHeader) {
    return null;
  }

  const { row, table } = ctx;
  const children = table.children!;

  // Collect indices of TableRow children (not TableHeader or TableDelimiter)
  const rowIndices: number[] = [];
  for (let i = 0; i < children.length; i++) {
    if (children[i].type === "TableRow") {
      rowIndices.push(i);
    }
  }

  const rowPos = rowIndices.indexOf(ctx.rowIndex);
  if (direction === "up" && rowPos <= 0) {
    return null;
  }
  if (direction === "down" && rowPos >= rowIndices.length - 1) {
    return null;
  }

  const otherPos = direction === "up" ? rowPos - 1 : rowPos + 1;
  const otherRow = children[rowIndices[otherPos]];

  const first = direction === "up" ? otherRow : row;
  const second = direction === "up" ? row : otherRow;

  return swapRegions(
    text,
    cursor,
    row.from!,
    direction,
    first.from!,
    first.to!,
    second.from!,
    second.to!,
  );
}

/**
 * Swaps a top-level paragraph with the adjacent document-level block.
 */
function moveParagraph(
  text: string,
  cursor: number,
  ctx: ParagraphContext,
  direction: "up" | "down",
): OutlineResult {
  const { blockIndex, doc } = ctx;
  const children = doc.children!;
  const currNode = children[blockIndex];

  // Find adjacent typed sibling
  let adjIdx = blockIndex + (direction === "up" ? -1 : 1);
  const step = direction === "up" ? -1 : 1;
  while (adjIdx >= 0 && adjIdx < children.length && !children[adjIdx].type) {
    adjIdx += step;
  }
  if (adjIdx < 0 || adjIdx >= children.length) {
    return null;
  }

  const adjNode = children[adjIdx];
  const first = direction === "up" ? adjNode : currNode;
  const second = direction === "up" ? currNode : adjNode;

  return swapRegions(
    text,
    cursor,
    currNode.from!,
    direction,
    first.from!,
    first.to!,
    second.from!,
    second.to!,
  );
}
