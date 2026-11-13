import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { isCheckboxState } from "../syntax/task.ts";
import { decoratorStateField } from "../util.ts";

type Slice = (from: number, to: number) => string;

/** The dropdown caret a custom task state (`[TODO]`) gets from task.ts takes a column. */
function dropdownColumns(taskState: SyntaxNode, slice: Slice): number {
  return isCheckboxState(slice(taskState.from, taskState.to)) ? 0 : 1;
}

/**
 * Compute the marker-zone width in source columns (== `ch` units) for a
 * single ListItem node.
 * @param listItem     The `ListItem` syntax node.
 * @param lineStart    Absolute offset of the line this list-item starts on.
 * @param quoteColumns Columns a blockquote marker run already reserves on
 *                     this line, subtracted so the two never double-count.
 * @param slice        The document's text, to tell a custom task state
 *                     (which adds its caret column) from a checkbox.
 */
export function computeMarkerWidth(
  listItem: SyntaxNode,
  lineStart: number,
  quoteColumns: number,
  slice: Slice,
): number {
  const mark = listItem.firstChild;
  if (!mark || mark.name !== "ListMark") {
    return 0;
  }
  const leadingIndent = mark.from - lineStart - quoteColumns;
  const markLength = mark.to - mark.from;
  // TaskState wraps `[X]` / `[done]` / etc. (length varies by status string).
  // Width contribution = TaskState range length + 1 for the trailing space.
  const taskState = listItem.getChild("Task")?.getChild("TaskState");
  const taskExtra = taskState
    ? taskState.to - taskState.from + 1 + dropdownColumns(taskState, slice)
    : 0;
  return leadingIndent + markLength + 1 + taskExtra;
}

/**
 * Pin a run of marker source to `columns` editor columns, whatever the font
 * makes of its glyphs. The line's hanging indent is computed in the same
 * unit, so with a proportional font the first row's markup and the wrapped
 * rows still meet the same edge, and swapping `*` for `•` or `[ ]` for a
 * checkbox leaves the text after it in place.
 */
function columnSlot(columns: number, cls = "") {
  return Decoration.mark({
    class: cls ? `sb-col-slot ${cls}` : "sb-col-slot",
    // Without this a replaced marker starting at the slot's edge (bullet,
    // checkbox) renders outside the slot element. The end stays exclusive so
    // the word joiner after the last slot sits outside it.
    inclusiveStart: true,
    attributes: { style: `--sb-slot-columns:${columns}` },
  });
}

/**
 * U+2060 after an item's markup. A slot is an atomic inline, which browsers
 * treat as a line-break opportunity; without this a long first word (a URL)
 * wraps away from its bullet and leaves the marker alone on its row.
 */
class WordJoiner extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "sb-word-joiner";
    span.textContent = "\u2060";
    return span;
  }

  override eq(): boolean {
    return true;
  }
}

const wordJoiner = Decoration.widget({ widget: new WordJoiner(), side: 1 });

function leadingWhitespace(text: string): number {
  return /^[ \t]*/.exec(text)![0].length;
}

/** Length of the longest marker (`1.`, `10.`, ...) among a list's items. */
function widestMarker(list: SyntaxNode): number {
  let widest = 0;
  for (let item = list.firstChild; item; item = item.nextSibling) {
    const mark = item.firstChild;
    if (item.name === "ListItem" && mark?.name === "ListMark") {
      widest = Math.max(widest, mark.to - mark.from);
    }
  }
  return widest;
}

/** A row's quote markup, from the tree: each `>` and the space after it. */
type QuoteRange = { from: number; to: number };

/**
 * Slots for a row's indentation up to `end`. In a quote, the `>` markup has
 * its own slot (block_quote.ts), so the spaces before it (an enclosing
 * item's) and after it (this item's) are pinned separately. `outerPad` is
 * what enclosing ordered items widened the row by, counted once: before the
 * quote when there is anything there, else after it. `extra` widens only the
 * part this item owns.
 */
function indentSlots(
  rowFrom: number,
  quote: QuoteRange | undefined,
  end: number,
  outerPad: number,
  extra: number,
): Range<Decoration>[] {
  const slots: Range<Decoration>[] = [];
  const pin = (from: number, to: number, columns: number) => {
    if (to > from) {
      slots.push(columnSlot(columns, "sb-indent-slot").range(from, to));
    }
  };
  if (!quote) {
    pin(rowFrom, end, end - rowFrom + outerPad + extra);
  } else {
    const before = quote.from - rowFrom;
    pin(rowFrom, quote.from, before + outerPad);
    pin(quote.to, end, end - quote.to + (before > 0 ? 0 : outerPad) + extra);
  }
  return slots;
}

/**
 * CommonMark lets an empty item (`* `, `1. `) not interrupt a paragraph, so
 * the row is paragraph text until its first letter makes it an item. Its
 * marker gets the slot it is about to get, or that letter moves the line: in
 * a proportional font `* ` is narrower than the marker's two columns. Only
 * markers that can interrupt a paragraph qualify: bullets and `1.`/`1)`.
 * Returns the row's slots with the marker's added, or `undefined` when the
 * row holds no such marker.
 */
function pendingMarkerSlots(
  line: { from: number; text: string },
  quoteEnd: number | undefined,
  rowSlots: Range<Decoration>[],
): Range<Decoration>[] | undefined {
  const start = (quoteEnd ?? line.from) - line.from;
  const ws = leadingWhitespace(line.text.slice(start));
  const marker = /^([-*+]|1[.)]) [ \t]*$/.exec(line.text.slice(start + ws));
  if (!marker) return undefined;
  const markFrom = line.from + start + ws;
  // On a continuation row of an item, the indent is pinned already, and the
  // marker must follow it directly to land where the nested item will.
  if (rowSlots.length > 0 && rowSlots[rowSlots.length - 1].to !== markFrom) {
    return undefined;
  }
  const slots =
    rowSlots.length > 0
      ? [...rowSlots]
      : indentSlots(line.from + start, undefined, markFrom, 0, 0);
  const markLength = marker[1].length;
  slots.push(
    columnSlot(
      markLength + 1,
      markLength > 1
        ? "sb-list-mark-slot sb-ordered-mark-slot"
        : "sb-list-mark-slot",
    ).range(markFrom, markFrom + markLength + 1),
  );
  return slots;
}

/**
 * Contribute a per-line `--sb-list-indent` for every line owned by a ListItem,
 * using `computeMarkerWidth` to derive the value from source. The `.cm-line`
 * rule in editor.scss sums it with the other indent contributions.
 *
 * Nested list lines: when we iterate the syntax tree, outer ListItems are
 * visited before their nested children. CodeMirror concatenates same-position
 * line decorations' `style` attributes with `;`, and the last declaration of
 * a given property wins — so the inner item's (deeper) marker width
 * overwrites the outer item's for the nested portion. This is the behavior
 * we want: every line gets the marker width of the innermost ListItem it
 * belongs to. Column slots follow the same innermost-wins rule via `slots`.
 *
 * Ordered lists lay out like an HTML `<ol>`: every item's number gets the
 * width of the list's widest one, right-aligned, so `9.` and `10.` items
 * start their text in the same place. Source indents nested content to the
 * item's own number width, so everything inside an item is widened by the
 * difference (`pad`), accumulated over enclosing items.
 */
export function listIndentPlugin() {
  return decoratorStateField((state: EditorState, _tr, range) => {
    const doc = state.doc;
    const slice: Slice = (from, to) => doc.sliceString(from, to);
    const lines: Range<Decoration>[] = [];
    // Each row's slots, built after the walk, when every row's quote markup
    // is known. Set in walk order, so an inner item's rows replace an outer
    // item's.
    const rows = new Map<number, () => Range<Decoration>[]>();
    const quotes = new Map<number, QuoteRange>();
    const widestByList = new Map<number, number>();
    // Per enclosing ListItem, innermost last: the columns enclosing ordered
    // items widened its content by, and the part of that a quote's bars
    // inside it follow (a list inside a quote leaves the quote's own bars in
    // place, so items whose markup comes after a `>` add nothing).
    const padding: { pad: number; barPad: number }[] = [];
    // Rows after a paragraph's first, where an item can start but not yet be
    // one (see `pendingMarkerSlots`).
    const paragraphRows: number[] = [];
    syntaxTree(state).iterate({
      from: range?.from,
      to: range?.to,
      enter: ({ type, from, to, node }) => {
        if (type.name === "Paragraph") {
          const first = doc.lineAt(from).number;
          for (let n = first + 1; n <= doc.lineAt(to).number; n++) {
            paragraphRows.push(doc.line(n).from);
          }
          return;
        }
        if (type.name === "QuoteMark") {
          // Matches block_quote.ts's rule exactly: the trailing space
          // belongs to the marker.
          const end = slice(to, to + 1) === " " ? to + 1 : to;
          const row = doc.lineAt(from).from;
          const known = quotes.get(row);
          quotes.set(row, {
            from: Math.min(known?.from ?? from, from),
            to: Math.max(known?.to ?? end, end),
          });
          return;
        }
        if (type.name !== "ListItem") return;
        const outer = padding[padding.length - 1] ?? { pad: 0, barPad: 0 };
        const mark = node.firstChild!;
        const ordered =
          mark.name === "ListMark" && /^\d/.test(slice(mark.from, mark.to));
        let pad = 0;
        if (ordered && node.parent) {
          const list = node.parent;
          if (!widestByList.has(list.from)) {
            widestByList.set(list.from, widestMarker(list));
          }
          pad = widestByList.get(list.from)! - (mark.to - mark.from);
        }
        const startLine = doc.lineAt(from);
        // QuoteMark precedes ListItem in document order on the same line, so
        // this row's quote is known by now.
        const quote = quotes.get(startLine.from);
        const own = {
          pad: outer.pad + pad,
          barPad: outer.barPad + (quote ? 0 : pad),
        };
        padding.push(own);
        const width = computeMarkerWidth(
          node,
          startLine.from,
          quote ? quote.to - quote.from : 0,
          slice,
        );
        if (width <= 0) return;
        const style =
          `--sb-list-indent:calc(${width + own.pad} * var(--editor-column))` +
          // Read by block_quote.ts, so a quote's bars move with the padding.
          (own.barPad > 0 ? `;--sb-list-pad:${own.barPad}` : "");
        const endLine = doc.lineAt(to);
        for (let n = startLine.number; n <= endLine.number; n++) {
          const row = doc.line(n);
          lines.push(
            Decoration.line({ attributes: { style } }).range(row.from),
          );
          if (n === startLine.number) continue;
          // Continuation rows (second paragraphs, fenced code) open with
          // the item's indent as plain spaces; only the part the item owns
          // is pinned, so code keeps its own indentation.
          rows.set(row.from, () => {
            const rowQuote = quote ? quotes.get(row.from) : undefined;
            const contentFrom = rowQuote?.to ?? row.from;
            const ws = Math.min(
              leadingWhitespace(slice(contentFrom, row.to)),
              width,
            );
            return indentSlots(
              row.from,
              rowQuote,
              contentFrom + ws,
              outer.pad,
              pad,
            );
          });
        }
        const markEnd =
          slice(mark.to, mark.to + 1) === " " ? mark.to + 1 : mark.to;
        const taskState = node.getChild("Task")?.getChild("TaskState");
        rows.set(startLine.from, () => {
          const slots = indentSlots(
            startLine.from,
            quote,
            mark.from,
            outer.pad,
            0,
          );
          slots.push(
            columnSlot(
              markEnd - mark.from + pad,
              ordered
                ? "sb-list-mark-slot sb-ordered-mark-slot"
                : "sb-list-mark-slot",
            ).range(mark.from, markEnd),
          );
          if (taskState) {
            const taskEnd =
              slice(taskState.to, taskState.to + 1) === " "
                ? taskState.to + 1
                : taskState.to;
            slots.push(
              columnSlot(
                taskEnd - taskState.from + dropdownColumns(taskState, slice),
                "sb-task-slot",
              ).range(taskState.from, taskEnd),
            );
          }
          slots.push(wordJoiner.range(slots[slots.length - 1].to));
          return slots;
        });
      },
      leave: ({ type }) => {
        if (type.name === "ListItem") padding.pop();
      },
    });
    const slots = new Map(
      [...rows].map(([row, build]) => [row, build()] as const),
    );
    for (const row of paragraphRows) {
      const pending = pendingMarkerSlots(
        doc.lineAt(row),
        quotes.get(row)?.to,
        slots.get(row) ?? [],
      );
      if (pending) slots.set(row, pending);
    }
    return Decoration.set([...lines, ...[...slots.values()].flat()], true);
  }, {});
}
