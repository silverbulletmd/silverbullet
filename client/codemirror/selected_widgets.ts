import type { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const SELECTED = "sb-widget-selected";

/** Whether the document range [from, to] lies inside a non-empty selection range. */
export function insideSelection(
  selection: EditorSelection,
  from: number,
  to: number,
): boolean {
  return selection.ranges.some(
    (range) => !range.empty && range.from <= from && to <= range.to,
  );
}

function markSelectedWidgets(view: EditorView) {
  const { selection } = view.state;
  for (const el of view.contentDOM.querySelectorAll<HTMLElement>(
    '.cm-line [contenteditable="false"]',
  )) {
    let selected = false;
    try {
      const from = view.posAtDOM(el, 0);
      const to = view.posAtDOM(el, el.childNodes.length);
      selected = insideSelection(selection, from, Math.max(from, to));
    } catch {
      // Not part of the document view (a nested widget's own DOM)
    }
    el.classList.toggle(SELECTED, selected);
  }
}

function clearSelectedWidgets(view: EditorView) {
  for (const el of view.contentDOM.querySelectorAll(`.${SELECTED}`)) {
    el.classList.remove(SELECTED);
  }
}

/**
 * CodeMirror's selection layer leaves gaps over inline widgets (a rendered
 * link, say), and while the pointer drags, decorations hold still so those
 * widgets stay rendered. This marks the widgets inside the selection, so CSS
 * can paint them as selected. While a range is selected it re-marks on every
 * update, since a widget redrawn (when the drag ends, say) comes back unmarked.
 */
export const selectedWidgets = EditorView.updateListener.of((update) => {
  const hasRange = update.state.selection.ranges.some((range) => !range.empty);
  if (hasRange) markSelectedWidgets(update.view);
  else if (update.selectionSet || update.docChanged) {
    clearSelectedWidgets(update.view);
  }
});
