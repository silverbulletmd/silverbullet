import { describe, expect, test } from "vitest";
import { history, isolateHistory, redo, undo } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import { computeExternalChanges } from "./external_merge.ts";
import {
  externalSource,
  externalUndoField,
} from "./codemirror/external_presence.ts";

// content_manager.ts itself pulls in the full editor extension chain
// (codemirror/editor_state.ts -> lua_widget.ts -> widget_sandbox_iframe.ts),
// which touches `document` at module scope and can't load under Node/vitest.
// These tests instead exercise the same CodeMirror transaction shape that
// ContentManager.applyExternalPatches dispatches -- isolateHistory.of("full")
// plus a changeset from computeExternalChanges -- against a headless
// EditorState, to verify the undo-isolation guarantee the feature promises.

describe("external patch transaction shape (headless EditorState)", () => {
  function dispatchExternalPatch(
    state: EditorState,
    base: string,
    disk: string,
  ): EditorState {
    const current = state.sliceDoc();
    const { changes } = computeExternalChanges(base, disk, current);
    return state.update({
      changes,
      annotations: [isolateHistory.of("full")],
    }).state;
  }

  test("undo inverts exactly the external change, even when adjacent to local typing", () => {
    // Without isolateHistory, CodeMirror's history groups adjacent,
    // userEvent-less transactions issued within its group-delay window into
    // a single undo step (see @codemirror/commands HistoryState.addChanges /
    // isAdjacent) -- exactly what would happen here, since the external
    // append lands right at the end of what the user just typed. This is
    // the scenario isolateHistory.of("full") exists to prevent.
    let state = EditorState.create({
      doc: "Hello",
      extensions: [history()],
    });

    // User types locally (goes into normal history)
    state = state.update({
      changes: { from: 5, insert: " typed" },
    }).state;
    expect(state.sliceDoc()).toBe("Hello typed");

    // An external write appends "!" right where the local insertion starts --
    // computeExternalChanges' `before: true` mapping keeps the local
    // insertion on the user's side, landing the external insert immediately
    // adjacent to it once mapped onto the current doc.
    state = dispatchExternalPatch(state, "Hello", "Hello!");
    expect(state.sliceDoc()).toBe("Hello! typed");

    // A command's "target" only needs { state, dispatch }, so we can drive
    // undo() headlessly by threading `state` through a small local stub.
    const target = {
      get state() {
        return state;
      },
      dispatch: (tr: { state: EditorState }) => {
        state = tr.state;
      },
    };

    // One undo should revert only the external change...
    expect(undo(target as any)).toBe(true);
    expect(state.sliceDoc()).toBe("Hello typed");

    // ...and a second undo reverts the user's own typing
    expect(undo(target as any)).toBe(true);
    expect(state.sliceDoc()).toBe("Hello");
  });

  test("echo (disk matches current) yields an empty changeset, nothing to dispatch", () => {
    const base = "Hello world\n";
    const disk = "Hello world\nExternal line\n";
    // Simulate our own write already having landed in the editor (echo)
    const current = disk;
    const { changes } = computeExternalChanges(base, disk, current);
    expect(changes.empty).toBe(true);
  });
});

describe("undo/redo of an external edit preserves the user's cursor (regression)", () => {
  // Mirrors ContentManager.applyExternalPatches's actual transaction shape
  // exactly, including externalSource, which externalUndoField needs in
  // order to track the edit.
  function dispatchExternalPatch(
    state: EditorState,
    base: string,
    disk: string,
  ): EditorState {
    const current = state.sliceDoc();
    const { changes } = computeExternalChanges(base, disk, current);
    return state.update({
      changes,
      annotations: [isolateHistory.of("full"), externalSource.of("external")],
    }).state;
  }

  // Simulates client/codemirror/external_presence.ts's externalUndoCursorFix:
  // after a transaction lands, if the field flagged a correction, apply it
  // as an immediate follow-up transaction, exactly like the production
  // EditorView.updateListener does.
  function applyPendingCorrection(state: EditorState): EditorState {
    const { correction } = state.field(externalUndoField);
    if (!correction) return state;
    return state.update({
      selection: correction,
      annotations: Transaction.addToHistory.of(false),
    }).state;
  }

  test("undo after the cursor has moved keeps the cursor where the user left it, not where it was before the external edit", () => {
    let state = EditorState.create({
      doc: "Hello world\n",
      extensions: [history(), externalUndoField],
    });

    // Page just loaded: cursor sits at 0, untouched.
    expect(state.selection.main.head).toBe(0);

    // External write lands while the cursor is still at 0.
    state = dispatchExternalPatch(
      state,
      "Hello world\n",
      "Hello world\nExternal line\n",
    );
    expect(state.sliceDoc()).toBe("Hello world\nExternal line\n");
    expect(state.selection.main.head).toBe(0);

    // *Then* the user moves the cursor -- the step a naive regression test
    // (or the existing e2e's click-right-before-undo) skips, which is
    // exactly why it missed this bug.
    state = state.update({ selection: { anchor: 6 } }).state;
    expect(state.selection.main.head).toBe(6);

    const target = {
      get state() {
        return state;
      },
      dispatch: (tr: { state: EditorState }) => {
        state = tr.state;
        state = applyPendingCorrection(state);
      },
    };

    expect(undo(target as any)).toBe(true);
    expect(state.sliceDoc()).toBe("Hello world\n");
    // The bug: CodeMirror's default undo would restore the selection
    // recorded before the external edit landed, i.e. position 0.
    expect(state.selection.main.head).toBe(6);

    // Redo brings the edit back and, symmetrically, must leave the cursor
    // wherever the user has it now rather than jumping elsewhere.
    state = state.update({ selection: { anchor: 3 } }).state;
    expect(redo(target as any)).toBe(true);
    expect(state.sliceDoc()).toBe("Hello world\nExternal line\n");
    expect(state.selection.main.head).toBe(3);
  });

  test("undo of the user's own edit still restores the pre-edit selection", () => {
    let state = EditorState.create({
      doc: "Hello",
      extensions: [history(), externalUndoField],
    });
    state = state.update({ changes: { from: 5, insert: " typed" } }).state;
    expect(state.sliceDoc()).toBe("Hello typed");

    // Cursor moves away after typing, before undo -- same shape as the
    // external-edit scenario above, but here the "jump back to where you
    // were before the edit" behaviour is correct and must survive.
    state = state.update({ selection: { anchor: 8 } }).state;

    const target = {
      get state() {
        return state;
      },
      dispatch: (tr: { state: EditorState }) => {
        state = tr.state;
        state = applyPendingCorrection(state);
      },
    };

    expect(undo(target as any)).toBe(true);
    expect(state.sliceDoc()).toBe("Hello");
    expect(state.selection.main.head).toBe(0);
  });
});
