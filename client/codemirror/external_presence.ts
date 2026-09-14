import {
  Annotation,
  type ChangeSet,
  type EditorSelection,
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  showTooltip,
  WidgetType,
} from "@codemirror/view";

const PRESENCE_TTL_MS = 5000;

/** Source label of an externally-applied change */
export const externalSource = Annotation.define<string>();

export type PresenceOrigin = {
  kind?: string;
  displayName?: string;
  source?: string;
};

/** Ghost-caret label for an externally-applied change. */
export function originLabel(origin?: PresenceOrigin): string {
  return origin?.displayName || "external";
}

export type PresenceHunk = {
  from: number;
  to: number;
  time: number;
  source: string;
};

type PresenceState = { hunks: PresenceHunk[] };

const emptyPresenceState: PresenceState = { hunks: [] };

/** Payload: the `Date.now()` the sweep ran at, so filtering stays pure. */
export const expirePresence = StateEffect.define<number>();

export const externalPresenceField = StateField.define<PresenceState>({
  create: () => emptyPresenceState,

  update(value, tr) {
    let hunks = value.hunks;

    if (tr.docChanged && hunks.length > 0) {
      hunks = hunks
        .map((h) => ({
          ...h,
          from: tr.changes.mapPos(h.from, 1),
          to: tr.changes.mapPos(h.to, -1),
        }))
        .filter((h) => h.to >= h.from);
    }

    const source = tr.annotation(externalSource);
    if (source !== undefined) {
      const now = Date.now();
      const added: PresenceHunk[] = [];
      tr.changes.iterChanges((_fromA, _toA, fromB, toB) => {
        added.push({ from: fromB, to: toB, time: now, source });
      });
      if (added.length > 0) {
        hunks = [...hunks, ...added];
      }
    }

    for (const effect of tr.effects) {
      if (effect.is(expirePresence)) {
        hunks = hunks.filter((h) => effect.value - h.time < PRESENCE_TTL_MS);
      }
    }

    return hunks === value.hunks ? value : { hunks };
  },
});

const MAX_TRACKED_EXTERNAL_EDITS = 100;

export type ExternalUndoState = {
  pendingUndo: readonly ChangeSet[];
  pendingRedo: readonly ChangeSet[];
  /** Set only on the transaction that just undid/redid an external edit. */
  correction?: EditorSelection;
};

const emptyExternalUndoState: ExternalUndoState = {
  pendingUndo: [],
  pendingRedo: [],
};

// ChangeSet.toJSON() nests arrays (insertions are encoded as sub-arrays), so
// this needs a deep compare, not a shallow one.
function changesEqual(a: ChangeSet, b: ChangeSet): boolean {
  return JSON.stringify(a.toJSON()) === JSON.stringify(b.toJSON());
}

// What CodeMirror's own history records for any doc-changing transaction
// (see HistEvent.fromTransaction in @codemirror/commands): the changes that
// would revert it, computed against the document it started from.
function invertOf(tr: Transaction): ChangeSet {
  return tr.changes.invert(tr.startState.doc);
}

/**
 * Tracks external undo/redo so it preserves the current cursor; local undo
 * retains CodeMirror's usual pre-edit selection restoration.
 *
 * Map pending changes through every edit like CodeMirror's history (mapEvent),
 * then match tr.changes structurally to recognize an external undo/redo.
 */
export const externalUndoField = StateField.define<ExternalUndoState>({
  create: () => emptyExternalUndoState,

  update(value, tr) {
    let pendingUndo = value.pendingUndo;
    let pendingRedo = value.pendingRedo;
    let correction: EditorSelection | undefined;

    if (tr.docChanged) {
      const topUndo = pendingUndo[pendingUndo.length - 1];
      const topRedo = pendingRedo[pendingRedo.length - 1];

      if (
        tr.isUserEvent("undo") &&
        topUndo &&
        changesEqual(tr.changes, topUndo)
      ) {
        pendingUndo = pendingUndo.slice(0, -1).map((cs) => cs.map(tr.changes));
        pendingRedo = [
          ...pendingRedo.map((cs) => cs.map(tr.changes)),
          invertOf(tr),
        ];
        correction = tr.startState.selection.map(tr.changes);
      } else if (
        tr.isUserEvent("redo") &&
        topRedo &&
        changesEqual(tr.changes, topRedo)
      ) {
        pendingRedo = pendingRedo.slice(0, -1).map((cs) => cs.map(tr.changes));
        pendingUndo = [
          ...pendingUndo.map((cs) => cs.map(tr.changes)),
          invertOf(tr),
        ];
        correction = tr.startState.selection.map(tr.changes);
      } else {
        pendingUndo = pendingUndo
          .map((cs) => cs.map(tr.changes))
          .filter((cs) => !cs.empty);
        pendingRedo = pendingRedo
          .map((cs) => cs.map(tr.changes))
          .filter((cs) => !cs.empty);

        if (
          !tr.isUserEvent("undo") &&
          !tr.isUserEvent("redo") &&
          tr.annotation(Transaction.addToHistory) !== false
        ) {
          // A genuine new edit invalidates whatever could previously be
          // redone, same as CodeMirror's own history.
          pendingRedo = [];
        }

        if (tr.annotation(externalSource) !== undefined && !tr.changes.empty) {
          pendingUndo = [...pendingUndo, invertOf(tr)];
        }
      }

      if (pendingUndo.length > MAX_TRACKED_EXTERNAL_EDITS) {
        pendingUndo = pendingUndo.slice(-MAX_TRACKED_EXTERNAL_EDITS);
      }
      if (pendingRedo.length > MAX_TRACKED_EXTERNAL_EDITS) {
        pendingRedo = pendingRedo.slice(-MAX_TRACKED_EXTERNAL_EDITS);
      }
    }

    if (
      pendingUndo === value.pendingUndo &&
      pendingRedo === value.pendingRedo &&
      correction === undefined &&
      value.correction === undefined
    ) {
      return value;
    }
    return { pendingUndo, pendingRedo, correction };
  },
});

// HistoryState.pop uses filter:false, so undo/redo selections cannot be
// rewritten by transactionFilter. Correct them in a follow-up transaction.
// EditorView is Idle during update listeners, allowing dispatch in the same
// synchronous flush without flicker.
const externalUndoCursorFix = EditorView.updateListener.of((update) => {
  const { correction } = update.state.field(externalUndoField);
  if (!correction) {
    return;
  }
  update.view.dispatch({
    selection: correction,
    annotations: Transaction.addToHistory.of(false),
  });
});

export function buildPresenceLabelElement(source: string): HTMLElement {
  const label = document.createElement("span");
  label.className = "sb-external-caret-label";
  label.textContent = source;
  return label;
}

class GhostCaretWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  override eq(other: GhostCaretWidget) {
    return other.source === this.source;
  }

  override toDOM() {
    const el = document.createElement("span");
    el.className = "sb-external-caret";
    el.setAttribute("data-source", this.source);
    return el;
  }
}

/** Exported so tests can assert the dot lands as a real element. */
export function buildDeletionMarkerElement(): HTMLElement {
  const el = document.createElement("span");
  el.className = "sb-external-delete-marker";
  // The anchor stays zero-width so it can't reflow the line; the dot itself
  // is drawn out of flow, in the left padding of the text column.
  const dot = document.createElement("span");
  dot.className = "sb-external-delete-dot";
  el.appendChild(dot);
  return el;
}

class DeletionMarkerWidget extends WidgetType {
  override eq() {
    return true;
  }

  override toDOM() {
    return buildDeletionMarkerElement();
  }
}

const deletionMarkerWidget = new DeletionMarkerWidget();

// A pure deletion collapses to a zero-width hunk (fromB === toB in
// tr.changes.iterChanges), so we mark the line it landed on rather than
// drawing an inline artifact for text that's no longer there.
function deletedLineStarts(
  state: EditorState,
  hunks: PresenceHunk[],
): number[] {
  const starts = new Set<number>();
  for (const h of hunks) {
    if (h.to !== h.from) {
      continue;
    }
    const pos = Math.min(Math.max(h.from, 0), state.doc.length);
    starts.add(state.doc.lineAt(pos).from);
  }
  return [...starts];
}

function newestPresence(state: EditorState): PresenceHunk | undefined {
  return state
    .field(externalPresenceField)
    .hunks.reduce<PresenceHunk | undefined>(
      (newest, hunk) => (!newest || hunk.time >= newest.time ? hunk : newest),
      undefined,
    );
}

function buildDecorations(state: EditorState): DecorationSet {
  const { hunks } = state.field(externalPresenceField);
  if (hunks.length === 0) {
    return Decoration.none;
  }

  const decos: Range<Decoration>[] = [];
  const newest = newestPresence(state);
  for (const h of hunks) {
    if (h.to > h.from) {
      decos.push(
        Decoration.mark({ class: "sb-external-edit" }).range(h.from, h.to),
      );
    }
  }
  for (const from of deletedLineStarts(state, hunks)) {
    decos.push(
      Decoration.widget({ widget: deletionMarkerWidget, side: -1 }).range(from),
    );
  }
  // Anonymous writes need only a highlight; their caret label adds no information.
  if (newest && newest.source !== "external") {
    decos.push(
      Decoration.widget({
        widget: new GhostCaretWidget(newest.source),
        side: 1,
      }).range(newest.to),
    );
  }
  return Decoration.set(decos, true);
}

// Sweeps are idempotent, so overlapping timers need no per-view bookkeeping.
// Stop scheduling when no hunks remain.
const presenceExpiry = EditorView.updateListener.of((update) => {
  const { hunks } = update.state.field(externalPresenceField);
  if (hunks.length === 0) {
    return;
  }
  const oldest = Math.min(...hunks.map((h) => h.time));
  const wait = Math.max(50, oldest + PRESENCE_TTL_MS - Date.now());
  setTimeout(() => {
    try {
      update.view.dispatch({ effects: expirePresence.of(Date.now()) });
    } catch {
      // View was destroyed before the sweep fired.
    }
  }, wait);
});

export function externalPresence(): Extension {
  return [
    externalPresenceField,
    EditorView.decorations.compute([externalPresenceField], (state) =>
      buildDecorations(state),
    ),
    showTooltip.compute([externalPresenceField], (state) => {
      const newest = newestPresence(state);
      if (!newest || newest.source === "external") {
        return null;
      }
      return {
        pos: newest.to,
        above: true,
        create: () => ({ dom: buildPresenceLabelElement(newest.source) }),
      };
    }),
    presenceExpiry,
    externalUndoField,
    externalUndoCursorFix,
  ];
}
