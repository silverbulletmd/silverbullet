import {
  BlockContext,
  Element,
  LeafBlock,
  LeafBlockParser,
  Line,
  MarkdownConfig,
} from "@lezer/markdown";
import { tags as t } from "@lezer/highlight";

// Forked from https://github.com/lezer-parser/markdown/blob/main/src/extension.ts
// MIT License
// Author: Marijn Haverbeke
// Change made: Avoid wiki links with aliases [[link|alias]] from being parsed as table row separators

function parseRow(
  cx: BlockContext,
  line: string,
  startI = 0,
  elts?: Element[],
  offset = 0,
) {
  let count = 0, first = true, cellStart = -1, cellEnd = -1, esc = false;
  let parseCell = () => {
    elts!.push(
      cx.elt(
        "TableCell",
        offset + cellStart,
        offset + cellEnd,
        cx.parser.parseInline(
          line.slice(cellStart, cellEnd),
          offset + cellStart,
        ),
      ),
    );
  };

  let inWikilink = false;
  for (let i = startI; i < line.length; i++) {
    let next = line.charCodeAt(i);
    if (next === 91 /* '[' */ && line.charAt(i + 1) === "[") {
      inWikilink = true;
    } else if (
      next === 93 /* ']' */ && line.charAt(i - 1) === "]" && inWikilink
    ) {
      inWikilink = false;
    }
    if (next == 124 /* '|' */ && !esc && !inWikilink) {
      if (!first || cellStart > -1) count++;
      first = false;
      if (elts) {
        if (cellStart > -1) parseCell();
        elts.push(cx.elt("TableDelimiter", i + offset, i + offset + 1));
      }
      cellStart = cellEnd = -1;
    } else if (esc || next != 32 && next != 9) {
      if (cellStart < 0) cellStart = i;
      cellEnd = i + 1;
    }
    esc = !esc && next == 92;
  }
  if (cellStart > -1) {
    count++;
    if (elts) parseCell();
  }
  return count;
}

function hasPipe(str: string, start: number) {
  for (let i = start; i < str.length; i++) {
    let next = str.charCodeAt(i);
    if (next == 124 /* '|' */) return true;
    if (next == 92 /* '\\' */) i++;
  }
  return false;
}

const delimiterLine = /^\|?(\s*:?-+:?\s*\|)+(\s*:?-+:?\s*)?$/;

class TableParser implements LeafBlockParser {
  // Null means we haven't seen the second line yet, false means this
  // isn't a table, and an array means this is a table and we've
  // parsed the given rows so far.
  rows: false | null | Element[] = null;

  nextLine(cx: BlockContext, line: Line, leaf: LeafBlock) {
    if (this.rows == null) { // Second line
      this.rows = false;
      let lineText;
      if (
        (line.next == 45 || line.next == 58 || line.next == 124 /* '-:|' */) &&
        delimiterLine.test(lineText = line.text.slice(line.pos))
      ) {
        let firstRow: Element[] = [],
          firstCount = parseRow(cx, leaf.content, 0, firstRow, leaf.start);
        if (firstCount == parseRow(cx, lineText, line.pos)) {
          this.rows = [
            cx.elt(
              "TableHeader",
              leaf.start,
              leaf.start + leaf.content.length,
              firstRow,
            ),
            cx.elt(
              "TableDelimiter",
              cx.lineStart + line.pos,
              cx.lineStart + line.text.length,
            ),
          ];
        }
      }
    } else if (this.rows) { // Line after the second
      let content: Element[] = [];
      parseRow(cx, line.text, line.pos, content, cx.lineStart);
      this.rows.push(
        cx.elt(
          "TableRow",
          cx.lineStart + line.pos,
          cx.lineStart + line.text.length,
          content,
        ),
      );
    }
    return false;
  }

  finish(cx: BlockContext, leaf: LeafBlock) {
    if (!this.rows) return false;
    cx.addLeafElement(
      leaf,
      cx.elt(
        "Table",
        leaf.start,
        leaf.start + leaf.content.length,
        this.rows as readonly Element[],
      ),
    );
    return true;
  }
}

/// This extension provides
/// [GFM-style](https://github.github.com/gfm/#tables-extension-)
/// tables, using syntax like this:
///
/// ```
/// | head 1 | head 2 |
/// | ---    | ---    |
/// | cell 1 | cell 2 |
/// ```
export const Table: MarkdownConfig = {
  defineNodes: [
    { name: "Table", block: true },
    { name: "TableHeader", style: { "TableHeader/...": t.heading } },
    "TableRow",
    { name: "TableCell", style: t.content },
    { name: "TableDelimiter", style: t.processingInstruction },
  ],
  parseBlock: [{
    name: "Table",
    leaf(_, leaf) {
      return hasPipe(leaf.content, 0) ? new TableParser() : null;
    },
    endLeaf(cx, line, leaf) {
      if (
        leaf.parsers.some((p) => p instanceof TableParser) ||
        !hasPipe(line.text, line.basePos)
      ) return false;
      // @ts-ignore: internal
      let next = cx.scanLine(cx.absoluteLineEnd + 1).text;
      return delimiterLine.test(next) &&
        parseRow(cx, line.text, line.basePos) ==
          parseRow(cx, next, line.basePos);
    },
    before: "SetextHeading",
  }],
};
