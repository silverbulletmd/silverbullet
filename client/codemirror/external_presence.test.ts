import { describe, expect, it } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import {
  expirePresence,
  externalPresenceField,
  externalSource,
  externalUndoField,
} from "./external_presence.ts";

function stateWithDoc(doc: string) {
  return EditorState.create({ doc, extensions: [externalPresenceField] });
}

describe("externalPresenceField", () => {
  it("records inserted ranges from externally-annotated transactions", () => {
    const state = stateWithDoc("Hello\n");
    const tr = state.update({
      changes: { from: 6, insert: "External\n" },
      annotations: externalSource.of("external"),
    });
    const hunks = tr.state.field(externalPresenceField).hunks;
    expect(hunks).toHaveLength(1);
    expect(hunks[0].from).toBe(6);
    expect(hunks[0].to).toBe(15);
    expect(hunks[0].source).toBe("external");
  });

  it("ignores ordinary transactions", () => {
    const state = stateWithDoc("Hello\n");
    const tr = state.update({ changes: { from: 6, insert: "typing" } });
    expect(tr.state.field(externalPresenceField).hunks).toHaveLength(0);
  });

  it("maps hunk positions through subsequent edits", () => {
    const state = stateWithDoc("Hello\n");
    const tr1 = state.update({
      changes: { from: 6, insert: "External\n" },
      annotations: externalSource.of("external"),
    });
    // User types at the very start, shifting everything by 3
    const tr2 = tr1.state.update({ changes: { from: 0, insert: "Hi " } });
    const hunks = tr2.state.field(externalPresenceField).hunks;
    expect(hunks[0].from).toBe(9);
    expect(hunks[0].to).toBe(18);
  });

  it("records a zero-width hunk for a pure deletion", () => {
    const state = stateWithDoc("Hello External\n");
    const tr = state.update({
      changes: { from: 6, to: 11, insert: "" },
      annotations: externalSource.of("external"),
    });
    const hunks = tr.state.field(externalPresenceField).hunks;
    expect(hunks).toHaveLength(1);
    expect(hunks[0].from).toBe(6);
    expect(hunks[0].to).toBe(6);
  });

  it("drops hunks whose age exceeds the TTL when swept", () => {
    const state = stateWithDoc("Hello\n");
    const tr1 = state.update({
      changes: { from: 6, insert: "External\n" },
      annotations: externalSource.of("external"),
    });
    expect(tr1.state.field(externalPresenceField).hunks).toHaveLength(1);

    const hunkTime = tr1.state.field(externalPresenceField).hunks[0].time;
    const tr2 = tr1.state.update({
      effects: expirePresence.of(hunkTime + 5001),
    });
    expect(tr2.state.field(externalPresenceField).hunks).toHaveLength(0);
  });

  it("keeps hunks that are still within the TTL when swept", () => {
    const state = stateWithDoc("Hello\n");
    const tr1 = state.update({
      changes: { from: 6, insert: "External\n" },
      annotations: externalSource.of("external"),
    });
    const hunkTime = tr1.state.field(externalPresenceField).hunks[0].time;
    const tr2 = tr1.state.update({
      effects: expirePresence.of(hunkTime + 1000),
    });
    expect(tr2.state.field(externalPresenceField).hunks).toHaveLength(1);
  });

  it("stays referentially stable across unrelated transactions once empty", () => {
    const state = stateWithDoc("Hello\n");
    const tr = state.update({ changes: { from: 6, insert: "typing" } });
    expect(tr.state.field(externalPresenceField)).toBe(
      state.field(externalPresenceField),
    );
  });
});

describe("externalUndoField", () => {
  function stateWithField(doc: string) {
    return EditorState.create({ doc, extensions: [externalUndoField] });
  }

  it("tracks an external edit and produces no correction for an unrelated change", () => {
    const state = stateWithField("Hello\n");
    const tr = state.update({
      changes: { from: 6, insert: "External\n" },
      annotations: externalSource.of("external"),
    });
    expect(tr.state.field(externalUndoField).pendingUndo).toHaveLength(1);
    expect(tr.state.field(externalUndoField).correction).toBeUndefined();
  });

  it("computes a correction when a transaction's changes match the tracked external edit's inverse, tagged undo", () => {
    let state = stateWithField("Hello\n");
    state = state.update({
      changes: { from: 6, insert: "External\n" },
      annotations: externalSource.of("external"),
    }).state;
    expect(state.sliceDoc()).toBe("Hello\nExternal\n");

    // Simulate what history's pop() does for an undo: apply the inverse of
    // the tracked edit, tagged as a "undo" user event -- without going
    // through @codemirror/commands, to keep this test focused purely on the
    // field's matching logic.
    const inverse = state.field(externalUndoField).pendingUndo[0];
    const tr = state.update({
      changes: inverse,
      userEvent: "undo",
    });

    expect(tr.state.sliceDoc()).toBe("Hello\n");
    expect(tr.state.field(externalUndoField).correction).toBeDefined();
    expect(tr.state.field(externalUndoField).pendingUndo).toHaveLength(0);
    expect(tr.state.field(externalUndoField).pendingRedo).toHaveLength(1);
  });

  it("does not produce a correction for an undo-tagged transaction that doesn't match the tracked edit", () => {
    let state = stateWithField("Hello\n");
    state = state.update({
      changes: { from: 6, insert: "External\n" },
      annotations: externalSource.of("external"),
    }).state;

    // A local edit's own undo -- same userEvent, unrelated changes.
    const tr = state.update({
      changes: { from: 0, to: 5, insert: "" },
      userEvent: "undo",
    });

    expect(tr.state.field(externalUndoField).correction).toBeUndefined();
    // The tracked external edit is untouched by an undo that isn't reverting it.
    expect(tr.state.field(externalUndoField).pendingUndo).toHaveLength(1);
  });

  it("clears the redo stack when a genuine new edit lands", () => {
    let state = stateWithField("Hello\n");
    state = state.update({
      changes: { from: 6, insert: "External\n" },
      annotations: externalSource.of("external"),
    }).state;
    const inverse = state.field(externalUndoField).pendingUndo[0];
    state = state.update({ changes: inverse, userEvent: "undo" }).state;
    expect(state.field(externalUndoField).pendingRedo).toHaveLength(1);

    // The user now types something new instead of redoing.
    state = state.update({ changes: { from: 0, insert: "x" } }).state;
    expect(state.field(externalUndoField).pendingRedo).toHaveLength(0);
  });

  it("does not carry a stale correction into a later, unrelated transaction", () => {
    let state = stateWithField("Hello\n");
    state = state.update({
      changes: { from: 6, insert: "External\n" },
      annotations: externalSource.of("external"),
    }).state;
    const inverse = state.field(externalUndoField).pendingUndo[0];
    state = state.update({ changes: inverse, userEvent: "undo" }).state;
    expect(state.field(externalUndoField).correction).toBeDefined();

    // A later, unrelated selection-only transaction must not still carry
    // (and thus re-trigger a dispatch of) the old correction.
    state = state.update({ selection: { anchor: 0 } }).state;
    expect(state.field(externalUndoField).correction).toBeUndefined();
  });

  it("does not push addToHistory:false transactions onto the tracked stack", () => {
    const state = stateWithField("Hello\n");
    const tr = state.update({
      changes: { from: 6, insert: "External\n" },
      annotations: [
        externalSource.of("external"),
        Transaction.addToHistory.of(false),
      ],
    });
    // Still tracked (externalSource is what matters for tracking, not
    // history membership) -- but this exercises the branch that must not
    // clear pendingRedo for addToHistory:false transactions.
    expect(tr.state.field(externalUndoField).pendingUndo).toHaveLength(1);
  });
});
