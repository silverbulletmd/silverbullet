// Where the line handle goes, and which lines are drawn as something other
// than their text (and so get no handle)
import type { Line } from "@codemirror/state";
import { BlockType, type EditorView } from "@codemirror/view";

/** The rendered `.cm-line` of a line, if it has one in the viewport */
export function lineElement(
  view: EditorView,
  line: Line,
): HTMLElement | undefined {
  for (const child of view.contentDOM.children) {
    if (!child.classList.contains("cm-line")) continue;
    try {
      if (view.posAtDOM(child, 0) === line.from) return child as HTMLElement;
    } catch {}
  }
}

/**
 * Whether a rendered `.cm-line` (of a non-empty line) stands for a whole-line
 * rendering rather than text: none of its own text is painted (all of it sits
 * in widgets or is hidden) and it holds either no widget at all (the source of
 * a block widget drawn beside it: a rendered table, an embed) or a block-level
 * Lua directive (a rendered query). A line of inline widgets, such as a lone
 * wiki link, still counts as text.
 */
export function showsWholeLineRendering(el: HTMLElement): boolean {
  const inWidget = (node: Node) => {
    const widget = node.parentElement?.closest('[contenteditable="false"]');
    return !!widget && el.contains(widget);
  };
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (text.textContent && !inWidget(text)) return false;
  }
  if (el.querySelector(".sb-lua-directive-block")) return true;
  const widgets = [...el.querySelectorAll('[contenteditable="false"]')].filter(
    (w) => !w.classList.contains("cm-widgetBuffer"),
  );
  return widgets.length === 0;
}

/**
 * Whether a line is drawn as something other than its text: replaced by a
 * block widget (rendered frontmatter, baked sections), hidden, or rendered
 * whole (see `showsWholeLineRendering`). Those have their own widget menus
 * (the ⋮ beside their card on desktop, `widgets/block_menu.ts`).
 */
export function lineIsReplaced(
  view: EditorView,
  line: Line,
  // Its rendered `.cm-line` (`lineElement`)
  el: HTMLElement | undefined,
): boolean {
  if (view.lineBlockAt(line.from).type === BlockType.WidgetRange) return true;
  if (!el || el.getClientRects().length === 0) return true;
  // A blank (or whitespace-only) line is never a rendering: it gets the
  // handle, for Insert… and Upload file
  return line.text.trim() !== "" && showsWholeLineRendering(el);
}

/** Where text starts in the editor (client x): past the content's padding */
export function textLeftEdge(view: EditorView): number {
  return (
    view.contentDOM.getBoundingClientRect().left +
    Number.parseFloat(getComputedStyle(view.contentDOM).paddingLeft)
  );
}

/** The leftmost painted x of visual row `row` of a line's element `el` */
function rowTextLeft(
  view: EditorView,
  el: HTMLElement | undefined,
  row: { top: number; bottom: number },
): number {
  let left = textLeftEdge(view);
  if (!el) return left;
  const range = document.createRange();
  range.selectNodeContents(el);
  for (const rect of range.getClientRects()) {
    const middle = (rect.top + rect.bottom) / 2;
    if (rect.width > 0 && middle >= row.top && middle <= row.bottom) {
      left = Math.min(left, rect.left);
    }
  }
  return left;
}

type HandlePlacement = { left: number; top: number; height: number };

/**
 * Where the handle goes (client coordinates), or undefined when the space left
 * of the line is too narrow: right-aligned `gap` left of the line's text on
 * its first visual row, as tall as that row. The text starts at `contentLeft`
 * when given (an indented line's first non-whitespace content, measured on
 * that row: the bullet or task box at its depth, since the indentation is
 * painted too), else at `paintedLeft`, the row's leftmost painted text (a
 * list bullet, or a revealed heading marker hanging into the padding).
 */
export function marginPlacement(options: {
  row: { top: number; bottom: number };
  paintedLeft: number;
  contentLeft?: number;
  /** Leftmost visible editor x */
  bound: number;
  width: number;
  gap?: number;
}): HandlePlacement | undefined {
  const { row, paintedLeft, contentLeft, bound, width, gap = 4 } = options;
  const left = (contentLeft ?? paintedLeft) - gap - width;
  if (left < bound) return;
  return { left, top: row.top, height: row.bottom - row.top };
}

/**
 * Client coordinates as coordinates in the scroller's content (for an
 * absolutely placed child of `view.scrollDOM`)
 */
function toScroller(
  view: EditorView,
  scroller: DOMRect,
  at: HandlePlacement,
): HandlePlacement {
  return {
    left: at.left - scroller.left + view.scrollDOM.scrollLeft,
    top: at.top - scroller.top + view.scrollDOM.scrollTop,
    height: at.height,
  };
}

/**
 * Where a handle `width` wide goes beside `line` (rendered as `el`), relative
 * to the scroller's content (as an absolutely placed child of
 * `view.scrollDOM`), or undefined when it can't be measured or there is no
 * room (see `marginPlacement`)
 */
export function handlePlacement(
  view: EditorView,
  line: Line,
  el: HTMLElement | undefined,
  width: number,
): HandlePlacement | undefined {
  const first = view.coordsAtPos(line.from, 1);
  if (!first) return;
  const row = { top: first.top, bottom: first.bottom };
  const scroller = view.scrollDOM.getBoundingClientRect();
  const indent = line.text.length - line.text.trimStart().length;
  const indented = line.number > 1 && indent > 0 && indent < line.length;
  const content = indented ? view.coordsAtPos(line.from + indent, 1) : null;
  const at = marginPlacement({
    row,
    paintedLeft: rowTextLeft(view, el, row),
    // Only when it is on the handle's row
    contentLeft:
      content && content.top < row.bottom && content.bottom > row.top
        ? content.left
        : undefined,
    bound: scroller.left,
    width,
  });
  return at && toScroller(view, scroller, at);
}

/**
 * Where a handle `width` wide goes beside a widget's card `card` (as
 * `handlePlacement` places it): left of the card, level with its top and one
 * line tall; undefined when there is no room or the card isn't shown
 */
export function cardPlacement(
  view: EditorView,
  card: HTMLElement,
  width: number,
): HandlePlacement | undefined {
  const rect = card.getBoundingClientRect();
  if (!card.isConnected || (rect.width === 0 && rect.height === 0)) return;
  const scroller = view.scrollDOM.getBoundingClientRect();
  const at = marginPlacement({
    row: { top: rect.top, bottom: rect.top + view.defaultLineHeight },
    paintedLeft: rect.left,
    bound: scroller.left,
    width,
  });
  return at && toScroller(view, scroller, at);
}
