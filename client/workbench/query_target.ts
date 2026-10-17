/**
 * Where the query goes: the spot `/Query…` was typed, or the query opened
 * from the page, kept in place while the page is edited, since the
 * Workbench stays open beside it.
 */
import { type ChangeDesc, StateEffect } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import type { InsertTarget, QueryBuilder } from "./query_builder.ts";

export function followEdits(
  builder: QueryBuilder,
  update: { docChanged: boolean; changes: ChangeDesc },
): void {
  const target = builder.target;
  if (!target || !update.docChanged) return;
  // Not a change listeners need to hear about: the bar shows the page, not the offsets
  const { changes } = update;
  if (target.from === target.to) {
    const pos = changes.mapPos(target.from);
    builder.target = { ...target, from: pos, to: pos };
    return;
  }
  // Text typed at either edge of a query stays outside it
  const from = changes.mapPos(target.from, 1);
  builder.target = {
    ...target,
    from,
    to: Math.max(from, changes.mapPos(target.to, -1)),
  };
}

// One listener per builder, so it's added to an editor state only once
const listeners = new WeakMap<QueryBuilder, (u: ViewUpdate) => void>();

/** Maps `builder.target` through the editor's edits from now on */
export function followTarget(view: EditorView, builder: QueryBuilder): void {
  let listener = listeners.get(builder);
  if (!listener) {
    listener = (u) => followEdits(builder, u);
    listeners.set(builder, listener);
  }
  // A page switch replaces the editor state, and with it this listener
  if (!view.state.facet(EditorView.updateListener).includes(listener)) {
    view.dispatch({
      effects: StateEffect.appendConfig.of(
        EditorView.updateListener.of(listener),
      ),
    });
  }
}

/** What to replace: the target on its own page, else the editor's cursor */
export function insertRange(
  target: InsertTarget | null,
  currentPage: string,
  docLength: number,
  head: number,
): { from: number; to: number; elsewhere: boolean } {
  if (!target) return { from: head, to: head, elsewhere: false };
  if (target.page !== currentPage) {
    return { from: head, to: head, elsewhere: true };
  }
  return {
    from: Math.min(target.from, docLength),
    to: Math.min(target.to, docLength),
    elsewhere: false,
  };
}
