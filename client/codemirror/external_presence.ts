import {
  Annotation,
  type ChangeSet,
  type EditorSelection,
  type Extension,
  type Range,
  RangeSet,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutter,
  WidgetType,
} from "@codemirror/view";

// How long the presence cursor will appear
const PRESENCE_TTL_MS = 5000;

/** Source label of an externally-applied change */
export const externalSource = Annotation.define<string>();

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
 * Tracks external edits through undo/redo so a revert of one of them can
 * keep the user's current cursor instead of CodeMirror's default of
 * restoring the selection recorded before the edit landed -- for an edit
 * applied before the user has touched the page, that's wherever the cursor
 * happened to sit on load (see externalUndoCursorFix below). Local edits are
 * untouched: their own pre-edit selection is exactly what undo should
 * restore, so only transactions carrying externalSource are tracked here.
 *
 * pendingUndo/pendingRedo mirror the same two ChangeSet, kept mapped
 * forward through every doc change exactly like CodeMirror's own history
 * does internally (see mapEvent), so that by the time a real undo/redo of
 * a tracked edit arrives, its tr.changes is structurally identical to our
 * stored entry -- that structural match is how "this undo/redo is reverting
 * an external edit" is recognized.
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

// CodeMirror's undo/redo transactions are dispatched with `filter: false`
// (see HistoryState.pop in @codemirror/commands), which skips the
// EditorState.transactionFilter facet entirely, so there's no way to rewrite
// their selection in place. Instead, externalUndoField above recognizes a
// matching undo/redo as it happens, and this listener issues a follow-up,
// non-historical, selection-only transaction right after. EditorView resets
// updateState to Idle before running update listeners (see
// EditorView.update), so dispatching here is safe and lands within the same
// synchronous flush as the undo/redo -- no visible flicker.
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
    // A real child element rather than CSS `content: attr(data-source)`,
    // so tests can assert the label and styling bugs (like the inherited
    // text-indent one fixed in editor.scss) stay debuggable in the DOM.
    const label = document.createElement("span");
    label.className = "sb-external-caret-label";
    label.textContent = this.source;
    el.appendChild(label);
    return el;
  }
}

class DeletionGutterMarker extends GutterMarker {
  override toDOM() {
    const el = document.createElement("span");
    el.className = "sb-external-delete-marker";
    return el;
  }
}

const deletionMarker = new DeletionGutterMarker();

function buildDecorations(state: PresenceState): DecorationSet {
  if (state.hunks.length === 0) {
    return Decoration.none;
  }

  const decos: Range<Decoration>[] = [];
  let newest: PresenceHunk | undefined;
  for (const h of state.hunks) {
    if (h.to > h.from) {
      decos.push(
        Decoration.mark({ class: "sb-external-edit" }).range(h.from, h.to),
      );
    }
    if (!newest || h.time >= newest.time) {
      newest = h;
    }
  }
  if (newest) {
    decos.push(
      Decoration.widget({
        widget: new GhostCaretWidget(newest.source),
        side: 1,
      }).range(newest.to),
    );
  }
  return Decoration.set(decos, true);
}

// A pure deletion collapses to a zero-width hunk (fromB === toB in
// tr.changes.iterChanges), so we mark the line it landed on rather than
// drawing an inline artifact for text that's no longer there.
function buildDeletionMarkers(view: EditorView): RangeSet<GutterMarker> {
  const { hunks } = view.state.field(externalPresenceField);
  if (hunks.length === 0) {
    return RangeSet.empty;
  }

  const docLength = view.state.doc.length;
  const lineStarts = new Set<number>();
  for (const h of hunks) {
    if (h.to !== h.from) {
      continue;
    }
    const pos = Math.min(Math.max(h.from, 0), docLength);
    lineStarts.add(view.state.doc.lineAt(pos).from);
  }
  if (lineStarts.size === 0) {
    return RangeSet.empty;
  }

  const ranges = [...lineStarts]
    .sort((a, b) => a - b)
    .map((pos) => deletionMarker.range(pos));
  return RangeSet.of(ranges);
}

// Runs once per relevant update rather than off a single owned interval;
// redundant sweeps are cheap and idempotent, and the empty-field early
// return means nothing is scheduled once hunks drain -- no per-view
// instance state is needed to dedupe overlapping timers.
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
      buildDecorations(state.field(externalPresenceField)),
    ),
    gutter({
      class: "sb-external-gutter",
      markers: buildDeletionMarkers,
    }),
    presenceExpiry,
    externalUndoField,
    externalUndoCursorFix,
  ];
}
