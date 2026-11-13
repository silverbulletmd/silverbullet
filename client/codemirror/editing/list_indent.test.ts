import { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { parser as baseParser } from "@lezer/markdown";
import { expect, test } from "vitest";
import { TaskList } from "../../markdown_parser/extended_task.ts";
import { buildExtendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { blockquotePlugin } from "../syntax/block_quote.ts";
import { computeMarkerWidth, listIndentPlugin } from "./list_indent.ts";

const parser = baseParser.configure([TaskList]);

const sliceOf = (source: string) => (from: number, to: number) =>
  source.slice(from, to);

// Parse a single-line markdown source and return its first ListItem node + line text.
function firstListItem(source: string): { node: SyntaxNode; source: string } {
  const tree = parser.parse(source);
  let node: SyntaxNode | null = null;
  tree.iterate({
    enter: (n) => {
      if (n.type.name === "ListItem" && !node) {
        node = n.node;
        return false;
      }
    },
  });
  if (!node) throw new Error(`no ListItem in: ${JSON.stringify(source)}`);
  return { node, source };
}

test("computeMarkerWidth: plain unordered with *", () => {
  const { node, source } = firstListItem("* item");
  expect(computeMarkerWidth(node, 0, 0, sliceOf(source))).toBe(2);
});

test("computeMarkerWidth: task at level 1", () => {
  const { node, source } = firstListItem("* [ ] task");
  expect(computeMarkerWidth(node, 0, 0, sliceOf(source))).toBe(6);
});

test("computeMarkerWidth: multi-status task `[done]`", () => {
  // `* [done] task` → marker zone = `* [done] ` = 9 chars, plus the ▾ a
  // custom state gets.
  const { node, source } = firstListItem("* [done] task");
  expect(computeMarkerWidth(node, 0, 0, sliceOf(source))).toBe(10);
});

test("computeMarkerWidth: ordered three digits", () => {
  const { node, source } = firstListItem("100. item");
  expect(computeMarkerWidth(node, 0, 0, sliceOf(source))).toBe(5);
});

test("computeMarkerWidth: respects non-zero lineStart", () => {
  // Two-line doc: first line is empty (or text), second line is "* item"
  const source = "intro\n* item";
  const tree = parser.parse(source);
  let node: SyntaxNode | null = null;
  tree.iterate({
    enter: (n) => {
      if (n.type.name === "ListItem" && !node) {
        node = n.node;
        return false;
      }
    },
  });
  if (!node) throw new Error("no ListItem");
  // Line start for the second line is at offset 6 (after "intro\n").
  expect(computeMarkerWidth(node, 6, 0, sliceOf(source))).toBe(2);
});

function lineStylesFor(doc: string): string[] {
  const field = listIndentPlugin();
  const state = EditorState.create({
    doc,
    extensions: [buildExtendedMarkdownLanguage(), field],
  });
  const styles: string[] = [];
  state.field(field).between(0, doc.length, (_from, _to, deco) => {
    const style = (deco.spec as any).attributes?.style;
    if (style?.startsWith("--sb-list-indent")) styles.push(style);
  });
  return styles;
}

const indent = (n: number) =>
  `--sb-list-indent:calc(${n} * var(--editor-column))`;

test("a list line contributes its marker width as a custom property", () => {
  expect(lineStylesFor("* one\n")).toEqual([indent(2)]);
});

test("a nested item contributes the innermost marker width", () => {
  // Outer then inner for the nested line; the inner one is added last and
  // therefore wins the concatenated style attribute.
  expect(lineStylesFor("* one\n  * two\n")).toEqual([
    indent(2),
    indent(2),
    indent(4),
  ]);
});

// Guards the invariant the two plugins jointly maintain: the sum of every
// `--sb-*-indent` contribution on a line must equal the number of columns
// its leading markup actually occupies, so a wrapped row's padding lines up
// with the first row's markers. Each plugin alone can't catch a regression
// where one starts double-counting what the other already reserves.
function summedIndentColumns(doc: string): number {
  const listField = listIndentPlugin();
  const quoteField = blockquotePlugin();
  const state = EditorState.create({
    doc,
    // Cursor parked outside the doc so no quote marker is revealed.
    selection: { anchor: doc.length },
    extensions: [buildExtendedMarkdownLanguage(), listField, quoteField],
  });
  const firstLineEnd = state.doc.line(1).to;
  let sum = 0;
  for (const field of [listField, quoteField]) {
    state.field(field).between(0, firstLineEnd, (_from, _to, deco) => {
      const style = (deco.spec as any).attributes?.style as string | undefined;
      // --sb-list-indent / --sb-quote-indent:calc(N * var(--editor-column))
      const match = style?.match(/^--sb-(?:list|quote)-indent:calc\((\d+)/);
      if (match) sum += Number(match[1]);
    });
  }
  return sum;
}

test("list and quote indent contributions sum to the real leading-markup width", () => {
  const cases: [string, number][] = [
    ["* item", 2], // `* `
    ["> quoted", 2], // `> `
    ["> * item one", 4], // `> * `
    ["> 1. numbered", 5], // `> 1. `
    ["> > * deep", 6], // `> > * `
    [">   * spaced", 6], // `>   * `
    ["  > * indented", 6], // `  > * `
  ];
  for (const [line, expected] of cases) {
    expect(summedIndentColumns(`${line}\n`)).toBe(expected);
  }
});

// The hanging indent only lines up if the first row's markup is held to the
// same columns the indent reserves; with a proportional font nothing else
// makes `*`, `•`, `[ ]` and spaces add up to it.
function slotColumns(doc: string): number {
  const field = listIndentPlugin();
  const state = EditorState.create({
    doc,
    extensions: [buildExtendedMarkdownLanguage(), field],
  });
  let sum = 0;
  state.field(field).between(0, state.doc.line(1).to, (_from, _to, deco) => {
    const match = (deco.spec as any).attributes?.style?.match(
      /^--sb-slot-columns:(\d+)/,
    );
    if (match) sum += Number(match[1]);
  });
  return sum;
}

test("column slots on an item's first row cover its whole marker width", () => {
  const cases: [string, number][] = [
    ["* item", 2],
    ["   * nested", 5],
    ["* [ ] task", 6],
    ["10. ten", 4],
    ["  3. [x] done", 9],
    ["* [IN PROGRESS] custom", 17],
  ];
  for (const [line, expected] of cases) {
    expect(slotColumns(`${line}\n`)).toBe(expected);
  }
});

test("ordered items share the widest number's width, and so does their content", () => {
  // `1.` is padded to `10.`'s width; the bullet nested under it moves by the
  // same column, so it still lines up with its parent's text.
  expect(lineStylesFor("1. one\n   * child\n10. ten\n")).toEqual([
    `${indent(4)};--sb-list-pad:1`,
    `${indent(4)};--sb-list-pad:1`,
    `${indent(6)};--sb-list-pad:1`,
    indent(4),
  ]);
});

function lineDecorations(doc: string, lineNo: number) {
  const listField = listIndentPlugin();
  const quoteField = blockquotePlugin();
  const state = EditorState.create({
    doc,
    selection: { anchor: doc.length },
    extensions: [buildExtendedMarkdownLanguage(), listField, quoteField],
  });
  const line = state.doc.line(lineNo);
  const collect = (field: typeof listField) => {
    const found: { from: number; to: number; spec: any }[] = [];
    state.field(field).between(line.from, line.to, (from, to, deco) => {
      if (from >= line.from && from <= line.to) {
        found.push({
          from: from - line.from,
          to: to - line.from,
          spec: deco.spec,
        });
      }
    });
    return found;
  };
  return { list: collect(listField), quote: collect(quoteField) };
}

function lineSlots(doc: string, lineNo: number) {
  return lineDecorations(doc, lineNo)
    .list.filter((d) => d.spec.class?.includes("sb-col-slot"))
    .map(({ from, to, spec }) => ({
      from,
      to,
      columns: Number(
        /--sb-slot-columns:(\d+)/.exec(spec.attributes.style)![1],
      ),
    }));
}

// Where the quote bars land, in editor columns: block_quote.ts's source
// offset plus whatever columns enclosing ordered items were padded by.
function quoteBarColumns(doc: string, lineNo: number): number {
  const { list, quote } = lineDecorations(doc, lineNo);
  const styles = [...quote, ...list]
    .map((d) => d.spec.attributes?.style as string | undefined)
    .filter(Boolean)
    .join(";");
  const offset = Number(
    /--sb-quote-bar-offset:calc\(\(?(\d+)/.exec(styles)![1],
  );
  const pads = [...styles.matchAll(/--sb-list-pad:(\d+)/g)];
  const pad = pads.length ? Number(pads[pads.length - 1][1]) : 0;
  return offset + pad;
}

test("a list continuation row inside a quote pins the item's indent after the marker", () => {
  // Row 3 keeps `> ` as the quote's; the two spaces after it are the item's.
  expect(lineSlots("> * item\n>\n>   second\n", 3)).toEqual([
    { from: 2, to: 4, columns: 2 },
  ]);
});

test("a quote inside a padded ordered item moves its bars with the padding", () => {
  // `1.` is padded by one column to match `10.`, so its content (and the
  // quote in it) starts one column further right than its source.
  expect(quoteBarColumns("1. one\n   > quoted\n10. ten\n", 2)).toBe(4);
});

test("a list inside a quote doesn't push the quote's own bars", () => {
  expect(quoteBarColumns("> 1. one\n> 10. ten\n", 1)).toBe(0);
});

test("a custom task state reserves a column for its dropdown", () => {
  // `* ` 2, `[TODO] ` 7, and the ▾ the task plugin adds after `]` 1.
  expect(slotColumns("* [TODO] custom\n")).toBe(10);
  expect(lineStylesFor("* [TODO] custom\n")).toEqual([indent(10)]);
});

test("a list in a quote in a list pins the spaces on both sides of the `>`", () => {
  // `  ` belongs to the outer item, `> ` to the quote (its own spacer), and
  // `* ` to the inner item; the spaces before the quote need a slot too.
  const doc = "* a\n  > * b\n  >   more\n";
  expect(lineSlots(doc, 2)).toEqual([
    { from: 0, to: 2, columns: 2 },
    { from: 4, to: 6, columns: 2 },
  ]);
  expect(lineSlots(doc, 3)).toEqual([
    { from: 0, to: 2, columns: 2 },
    { from: 4, to: 6, columns: 2 },
  ]);
});

// The slots on a row, with the class that picks their face.
function rowLayout(doc: string, lineNo: number) {
  return lineDecorations(doc, lineNo)
    .list.filter((d) => d.spec.class?.includes("sb-col-slot"))
    .map(({ from, to, spec }) => ({
      from,
      to,
      cls: spec.class,
      style: spec.attributes.style,
    }));
}

test("an empty item under a paragraph is laid out as the item it becomes", () => {
  // CommonMark: an empty item can't interrupt a paragraph, so until the
  // first letter `* ` is paragraph text. It must already sit where the
  // marker will, or typing that letter shifts the line.
  for (const [before, row] of [
    ["Grab bag:\n* ", 2],
    ["Grab bag:\n+ ", 2],
    ["Grab bag:\n1. ", 2],
    ["Grab bag:\n1) ", 2],
    ["Grab bag:\n  * ", 2],
    ["* item\n  * ", 2],
    ["* item\n* ", 2],
    ["> Grab bag:\n> * ", 2],
  ] as const) {
    expect(rowLayout(before, row), JSON.stringify(before)).toEqual(
      rowLayout(`${before}H`, row),
    );
  }
});

test("a numbered line that can't start a list under a paragraph stays text", () => {
  // Only `1.` may interrupt a paragraph; `2. ` stays text when typed on.
  expect(rowLayout("Grab bag:\n2. ", 2)).toEqual([]);
});
