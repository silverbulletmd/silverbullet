import { codeFolding, foldEffect } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { getRevisionDiff, openRevisionPreview } = vi.hoisted(() => ({
  getRevisionDiff: vi.fn(),
  openRevisionPreview: vi.fn(),
}));
vi.mock("../navigator/views/revisions.ts", () => ({ openRevisionPreview }));
vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  space: { getRevisionDiff },
}));

import {
  EditorGutterStore,
  editorGutterExtension,
  editorGutterOffset,
  editorGutterState,
  handleEditorGutterClick,
  handleEditorGutterKeydown,
  type NamedEditorGutter,
  normalizeEditorGutter,
} from "./gutter.ts";
import {
  editorGutterDiffPosition,
  editorGutterDiffState,
  openEditorGutterDiff,
  parseEditorGutterDiff,
  setEditorGutterDiffEffect,
} from "./gutter_diff.ts";
import { setEditorGuttersEffect } from "./gutter_effects.ts";

const blameGutter: NamedEditorGutter = {
  id: "blame",
  width: 12,
  markers: [
    { line: 1, text: "alice", title: "alice - 2026-09-01" },
    { line: 3, text: "bob" },
  ],
};

function stateWithGutters(
  gutters: readonly NamedEditorGutter[] = [blameGutter],
  doc = "one\ntwo\nthree",
) {
  return EditorState.create({
    doc,
    extensions: editorGutterExtension("note.md", gutters),
  });
}

function rows(state: EditorState) {
  const result: Array<{
    from: number;
    cells: readonly { text: string; title?: string }[];
  }> = [];
  const cursor = state.field(editorGutterState).markers.iter();
  while (cursor.value) {
    result.push({
      from: cursor.from,
      cells: cursor.value.cells.map(({ text, title }) => ({ text, title })),
    });
    cursor.next();
  }
  return result;
}

describe("editor gutter state", () => {
  test("renders named gutters at one-based document lines", () => {
    const state = stateWithGutters([
      blameGutter,
      {
        id: "review",
        markers: [
          { line: 1, text: "!" },
          { line: 2, text: "?" },
        ],
      },
    ]);

    expect(rows(state)).toEqual([
      {
        from: 0,
        cells: [
          { text: "alice", title: "alice - 2026-09-01" },
          { text: "!", title: undefined },
        ],
      },
      {
        from: 4,
        cells: [
          { text: "", title: undefined },
          { text: "?", title: undefined },
        ],
      },
      {
        from: 8,
        cells: [
          { text: "bob", title: undefined },
          { text: "", title: undefined },
        ],
      },
    ]);
  });

  test("replaces the complete set when a plug publishes an update", () => {
    const state = stateWithGutters();
    const next = state.update({
      effects: setEditorGuttersEffect.of([
        { id: "blame", markers: [{ line: 2, text: "carol" }] },
      ]),
    }).state;

    expect(rows(next)).toEqual([
      {
        from: 4,
        cells: [{ text: "carol", title: undefined }],
      },
    ]);
    expect(next.field(editorGutterState).stale).toBe(false);
  });

  test("keeps line annotations visible while the provider refreshes", () => {
    const state = stateWithGutters();
    const next = state.update({
      changes: { from: 4, insert: "new\n" },
    }).state;

    expect(next.field(editorGutterState).gutters).toEqual(
      state.field(editorGutterState).gutters,
    );
    expect(next.field(editorGutterState).stale).toBe(true);
    expect(rows(next)).toEqual([
      {
        from: 0,
        cells: [{ text: "alice", title: "alice - 2026-09-01" }],
      },
      { from: 12, cells: [{ text: "bob", title: undefined }] },
    ]);
  });

  test("ignores markers outside the current document", () => {
    const state = stateWithGutters([
      {
        id: "test",
        markers: [
          { line: 0, text: "before" },
          { line: 99, text: "missing" },
        ],
      },
    ]);

    expect(rows(state)).toEqual([]);
    expect(state.field(editorGutterState).activeColumns).toEqual([]);
  });

  test("groups adjacent rows by revision and keeps the revision line range", () => {
    const firstRevision = "a".repeat(40);
    const secondRevision = "b".repeat(40);
    const state = stateWithGutters(
      [
        {
          id: "blame",
          markers: [
            { line: 1, text: "alice", rev: firstRevision, revisionLine: 8 },
            { line: 2, text: "alice", rev: firstRevision, revisionLine: 9 },
            { line: 3, text: "alice", rev: firstRevision, revisionLine: 10 },
            { line: 4, text: "alice", rev: secondRevision, revisionLine: 1 },
            { line: 5, text: "alice", rev: secondRevision, revisionLine: 2 },
          ],
        },
      ],
      "one\ntwo\nthree\nfour\nfive",
    );

    const groups: Array<{ position?: string; group?: unknown }> = [];
    const cursor = state.field(editorGutterState).markers.iter();
    while (cursor.value) {
      const cell = cursor.value.cells[0] as {
        groupPosition?: string;
        group?: unknown;
      };
      groups.push({ position: cell.groupPosition, group: cell.group });
      cursor.next();
    }

    expect(groups.map(({ position }) => position)).toEqual([
      "start",
      "middle",
      "end",
      "start",
      "end",
    ]);
    expect(groups[0].group).toEqual({
      id: `blame:1:${firstRevision}`,
      gutterId: "blame",
      rev: firstRevision,
      startLine: 1,
      endLine: 3,
      revisionLines: [8, 9, 10],
      revisionStartLine: 8,
      revisionEndLine: 10,
    });
  });

  test("keeps non-contiguous revision lines instead of widening the selection", () => {
    const revision = "c".repeat(40);
    const state = stateWithGutters(
      [
        {
          id: "blame",
          markers: [
            { line: 1, text: "alice", rev: revision, revisionLine: 2 },
            { line: 2, text: "alice", rev: revision, revisionLine: 8 },
          ],
        },
      ],
      "one\ntwo",
    );
    const group = state.field(editorGutterState).markers.iter().value!.cells[0]
      .group!;

    expect(group.revisionLines).toEqual([2, 8]);
    expect(group.revisionStartLine).toBe(2);
    expect(group.revisionEndLine).toBe(8);
  });

  test("uses the longest marker text when width is not explicit", () => {
    const state = stateWithGutters([
      {
        id: "width",
        markers: [
          { line: 1, text: "x" },
          { line: 2, text: "longest" },
        ],
      },
    ]);

    expect(state.field(editorGutterState).activeColumns[0].width).toBe(7);
  });
});

describe("editor gutter input", () => {
  test("sorts rows, keeps the last duplicate, and filters unsafe classes", () => {
    expect(
      normalizeEditorGutter({
        width: 10,
        className: "sb-blame <unsafe>",
        markers: [
          { line: 3, text: "three" },
          { line: 2, text: "old" },
          { line: 1, text: "one", className: "fresh" },
          { line: 2, text: "new" },
        ],
      }),
    ).toEqual({
      width: 10,
      className: "sb-blame",
      markers: [
        {
          line: 1,
          text: "one",
          className: "fresh",
          revisionLine: undefined,
        },
        {
          line: 2,
          text: "new",
          className: undefined,
          revisionLine: undefined,
        },
        {
          line: 3,
          text: "three",
          className: undefined,
          revisionLine: undefined,
        },
      ],
    });
  });

  test("rejects invalid marker lines and widths", () => {
    expect(() =>
      normalizeEditorGutter({ markers: [{ line: 0, text: "bad" }] }),
    ).toThrow("positive integers");
    expect(() => normalizeEditorGutter({ width: 81, markers: [] })).toThrow(
      "between 1 and 80",
    );
    expect(() =>
      normalizeEditorGutter({
        markers: [{ line: 1, text: "bad", revisionLine: 0 }],
      }),
    ).toThrow("revisionLine must be a positive integer");
  });

  test("keeps valid revisions and rejects abbreviated revisions", () => {
    const rev = "A".repeat(40);
    expect(
      normalizeEditorGutter({ markers: [{ line: 1, text: "alice", rev }] }),
    ).toEqual({
      markers: [
        {
          line: 1,
          text: "alice",
          rev,
          revisionLine: undefined,
          title: undefined,
          className: undefined,
        },
      ],
      width: undefined,
      className: undefined,
    });
    expect(() =>
      normalizeEditorGutter({
        markers: [{ line: 1, text: "alice", rev: "abc" }],
      }),
    ).toThrow("40-character hexadecimal hashes");
  });
});

describe("EditorGutterStore", () => {
  test("isolates pages and owners, with guarded clears", () => {
    const store = new EditorGutterStore();
    store.set("alice", "blame", "Page A", {
      markers: [{ line: 1, text: "alice" }],
    });
    store.set("bob", "blame", "Page A", {
      markers: [{ line: 1, text: "bob" }],
    });
    store.set("alice", "other", "Page B", {
      markers: [{ line: 1, text: "alice" }],
    });

    expect(store.forPage("Page A").map(({ id }) => id)).toEqual([
      "alice/blame",
      "bob/blame",
    ]);
    expect(store.clear("alice", "other", "Page B")).toBe(true);
    expect(store.clear("bob", "blame", "Page B")).toBe(false);
    expect(store.forPage("Page A")).toHaveLength(2);

    store.clearOwner("alice");
    expect(store.forPage("Page A").map(({ id }) => id)).toEqual(["bob/blame"]);
  });
});

describe("editor gutter DOM", () => {
  test("renders marker text as text content", () => {
    class FakeClassList {
      values: string[] = [];

      add(...names: string[]) {
        this.values.push(...names);
      }
    }

    class FakeElement {
      className = "";
      classList = new FakeClassList();
      style: Record<string, string> = {};
      textContent = "";
      title = "";
      dataset: Record<string, string> = {};
      children: FakeElement[] = [];
      tabIndex = -1;

      appendChild(child: FakeElement) {
        this.children.push(child);
      }

      setAttribute() {}
    }

    (globalThis as unknown as { document: unknown }).document = {
      createElement: () => new FakeElement(),
    };

    const state = stateWithGutters([
      {
        id: "blame",
        markers: [{ line: 1, text: "<img src=x onerror=alert(1)>" }],
      },
    ]);
    const marker = state.field(editorGutterState).markers.iter().value!;
    const element = marker.toDOM({} as never) as unknown as FakeElement;

    expect(element.children[0].textContent).toBe(
      "<img src=x onerror=alert(1)>",
    );
    expect(element.children[0].children).toHaveLength(0);
  });

  test("places a wide-screen gutter next to the centered content column", () => {
    expect(editorGutterOffset(300, 80)).toBe(212);
    expect(editorGutterOffset(20, 80)).toBe(0);
    expect(editorGutterOffset(300, 292, 212)).toBe(212);
  });

  test("accepts case-insensitive Markdown paths for marker interaction", () => {
    const state = stateWithGutters([
      { id: "blame", markers: [{ line: 1, text: "alice" }] },
    ]);
    const target = {
      closest: () => ({ dataset: { gutterId: "blame" } }),
    };

    expect(
      handleEditorGutterClick(
        "NOTE.MD",
        { state, dispatch: vi.fn() } as never,
        { from: 0 } as never,
        { target, button: 0 } as never,
      ),
    ).toBe(true);
  });
});

describe("editor gutter clicks", () => {
  beforeEach(() => {
    getRevisionDiff.mockReset();
    getRevisionDiff.mockReturnValue(new Promise(() => {}));
    openRevisionPreview.mockReset();
    openRevisionPreview.mockResolvedValue(false);
  });

  test("opens an inline diff request for the committed revision group", () => {
    const rev = "a".repeat(40);
    const state = stateWithGutters([
      {
        id: "blame",
        markers: [
          { line: 1, text: "alice", rev, revisionLine: 4 },
          { line: 2, text: "alice", rev, revisionLine: 5 },
        ],
      },
    ]);
    const dispatch = vi.fn();
    const target = {
      closest: () => ({ dataset: { gutterId: "blame" } }),
    };

    expect(
      handleEditorGutterClick(
        "note.md",
        { state, dispatch } as never,
        { from: 0 } as never,
        { target, button: 0 } as never,
      ),
    ).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ effects: expect.anything() });
    const effect = dispatch.mock.calls[0][0].effects;
    const next = state.update({ effects: effect }).state;
    expect(next.field(editorGutterDiffState).status).toBe("loading");
    expect(next.field(editorGutterDiffState).request?.group).toMatchObject({
      startLine: 1,
      endLine: 2,
      revisionStartLine: 4,
      revisionEndLine: 5,
      rev,
    });
    expect(openRevisionPreview).not.toHaveBeenCalled();
  });

  test("does not use stale line metadata while the provider refreshes", () => {
    const state = stateWithGutters([
      { id: "dirty", markers: [{ line: 1, text: "!" }] },
    ]).update({ changes: { from: 0, insert: "new\n" } }).state;
    const target = {
      closest: () => ({ dataset: { gutterId: "dirty" } }),
    };

    expect(
      handleEditorGutterClick(
        "note.md",
        { state, dispatch: vi.fn() } as never,
        { from: 0 } as never,
        { target, button: 0 } as never,
      ),
    ).toBe(false);
  });

  test("opens an inline diff request for an uncommitted marker", () => {
    const state = stateWithGutters([
      { id: "dirty", markers: [{ line: 2, text: "!" }] },
    ]);
    const dispatch = vi.fn();
    const target = {
      closest: () => ({ dataset: { gutterId: "dirty" } }),
    };

    expect(
      handleEditorGutterClick(
        "note.md",
        { state, dispatch } as never,
        { from: 4 } as never,
        { target, button: 0 } as never,
      ),
    ).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ effects: expect.anything() });
    expect(openRevisionPreview).not.toHaveBeenCalled();
  });

  test("does not open history from a filler cell", () => {
    const state = stateWithGutters([
      {
        id: "blame",
        markers: [{ line: 1, text: "alice" }],
      },
      { id: "dirty", markers: [{ line: 2, text: "!" }] },
    ]);
    const target = {
      closest: () => ({ dataset: { gutterId: "dirty" } }),
    };

    expect(
      handleEditorGutterClick(
        "note.md",
        { state, dispatch: vi.fn() } as never,
        { from: 0 } as never,
        { target, button: 0 } as never,
      ),
    ).toBe(false);
    expect(openRevisionPreview).not.toHaveBeenCalled();
  });

  test("opens an inline diff from Enter on a marker", () => {
    const rev = "b".repeat(40);
    const state = stateWithGutters([
      {
        id: "blame",
        markers: [{ line: 1, text: "alice", rev }],
      },
    ]);
    const dispatch = vi.fn();
    const target = {
      closest: () => ({ dataset: { gutterId: "blame" } }),
    };

    expect(
      handleEditorGutterKeydown(
        "note.md",
        { state, dispatch } as never,
        { from: 0 } as never,
        { target, key: "Enter" } as never,
      ),
    ).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ effects: expect.anything() });
  });
});

describe("editor gutter diffs", () => {
  test("keeps an open diff while the provider refreshes its gutter", () => {
    const rev = "a".repeat(40);
    const group = {
      id: `blame:1:${rev}`,
      gutterId: "blame",
      rev,
      startLine: 1,
      endLine: 1,
      revisionLines: [1],
      revisionStartLine: 1,
      revisionEndLine: 1,
    };
    const state = EditorState.create({
      doc: "one",
      extensions: editorGutterExtension("note.md", []),
    });
    const opened = state.update({
      effects: setEditorGutterDiffEffect.of({
        type: "open",
        request: { id: 1, pagePath: "note.md", group },
      }),
    }).state;
    const refreshed = opened.update({
      effects: setEditorGuttersEffect.of([
        { id: "blame", markers: [{ line: 1, text: "alice", rev }] },
      ]),
    }).state;

    expect(refreshed.field(editorGutterDiffState).status).toBe("loading");
    expect(refreshed.field(editorGutterDiffState).request?.id).toBe(1);
  });

  test("moves a diff anchor after a folded range", () => {
    const state = EditorState.create({
      doc: "---\ntags: [one]\n---\nbody",
      extensions: codeFolding(),
    });
    const folded = state.update({
      effects: foldEffect.of({ from: 0, to: state.doc.line(3).to }),
    }).state;

    expect(editorGutterDiffPosition(folded, folded.doc.line(1).to)).toBe(
      folded.doc.line(3).to,
    );
    expect(editorGutterDiffPosition(folded, folded.doc.line(4).to)).toBe(
      folded.doc.line(4).to,
    );
  });

  test("keeps only the changed segment that touches the selected group", () => {
    expect(
      parseEditorGutterDiff(
        [
          "diff --git a/note.md b/note.md",
          "@@ -1,9 +1,9 @@",
          " context before",
          "-old",
          "+new",
          " context between",
          " context still between",
          "-far old",
          "+far new",
          " context after",
        ].join("\n"),
        2,
        2,
      ),
    ).toEqual([
      { text: "@@ -1,9 +1,9 @@", cssClass: "sb-revision-diff-hunk" },
      { text: "-old", cssClass: "sb-revision-diff-del" },
      { text: "+new", cssClass: "sb-revision-diff-add" },
    ]);
  });

  test("does not include another changed segment in the same hunk", () => {
    expect(
      parseEditorGutterDiff(
        "@@ -1,9 +1,9 @@\n context before\n-old\n+new\n context between\n context still between\n-far old\n+far new\n context after",
        5,
        5,
      ),
    ).toEqual([
      { text: "@@ -1,9 +1,9 @@", cssClass: "sb-revision-diff-hunk" },
      { text: "-far old", cssClass: "sb-revision-diff-del" },
      { text: "+far new", cssClass: "sb-revision-diff-add" },
    ]);
  });

  test("clips a large changed segment to the exact selected revision lines", () => {
    expect(
      parseEditorGutterDiff(
        "@@ -1,6 +1,6 @@\n+one\n+two\n+three\n+four\n+five\nsix",
        2,
        5,
        [2, 5],
      ),
    ).toEqual([
      { text: "@@ -1,6 +1,6 @@", cssClass: "sb-revision-diff-hunk" },
      { text: "+two", cssClass: "sb-revision-diff-add" },
      { text: "+five", cssClass: "sb-revision-diff-add" },
    ]);
  });

  test("keeps the deleted side of a selected replacement without context", () => {
    expect(
      parseEditorGutterDiff(
        "@@ -1,5 +1,5 @@\n-old\n+new\n+another new\n context\n-far old\n+far new",
        1,
        1,
        [1],
      ),
    ).toEqual([
      { text: "@@ -1,5 +1,5 @@", cssClass: "sb-revision-diff-hunk" },
      { text: "-old", cssClass: "sb-revision-diff-del" },
      { text: "+new", cssClass: "sb-revision-diff-add" },
    ]);
  });

  test("handles a zero-line new range for a deletion hunk", () => {
    expect(parseEditorGutterDiff("@@ -3 +3,0 @@\n-deleted", 3, 3)).toEqual([
      { text: "@@ -3 +3,0 @@", cssClass: "sb-revision-diff-hunk" },
      { text: "-deleted", cssClass: "sb-revision-diff-del" },
    ]);
  });

  test("ignores a late result after the request was replaced", () => {
    const rev = "a".repeat(40);
    const group = {
      id: `blame:1:${rev}`,
      gutterId: "blame",
      rev,
      startLine: 1,
      endLine: 1,
      revisionLines: [1],
      revisionStartLine: 1,
      revisionEndLine: 1,
    };
    const state = EditorState.create({
      doc: "one",
      extensions: editorGutterExtension("note.md", []),
    });
    const first = state.update({
      effects: setEditorGutterDiffEffect.of({
        type: "open",
        request: { id: 1, pagePath: "note.md", group },
      }),
    }).state;
    const second = first.update({
      effects: setEditorGutterDiffEffect.of({
        type: "open",
        request: {
          id: 2,
          pagePath: "note.md",
          group: { ...group, id: "other" },
        },
      }),
    }).state;
    const stale = second.update({
      effects: setEditorGutterDiffEffect.of({
        type: "result",
        requestId: 1,
        lines: [{ text: "+stale" }],
      }),
    }).state;

    expect(stale.field(editorGutterDiffState).request?.id).toBe(2);
    expect(stale.field(editorGutterDiffState).status).toBe("loading");
  });

  test("loads the selected revision and publishes the matching hunk", async () => {
    const rev = "c".repeat(40);
    const group = {
      id: `blame:2:${rev}`,
      gutterId: "blame",
      rev,
      startLine: 1,
      endLine: 2,
      revisionLines: [2, 3],
      revisionStartLine: 2,
      revisionEndLine: 3,
    };
    getRevisionDiff.mockReset();
    getRevisionDiff.mockResolvedValue("@@ -2,2 +2,2 @@\n-old\n+new\n");
    let currentState = EditorState.create({
      doc: "one\ntwo",
      extensions: editorGutterExtension("note.md", []),
    });
    const view = {
      get state() {
        return currentState;
      },
      dispatch(spec: { effects: unknown }) {
        currentState = currentState.update({
          effects: spec.effects as never,
        }).state;
      },
    };

    openEditorGutterDiff(view as never, "note.md", group);
    expect(currentState.field(editorGutterDiffState).status).toBe("loading");
    await vi.waitFor(() => {
      expect(currentState.field(editorGutterDiffState).status).toBe("ready");
    });

    expect(getRevisionDiff).toHaveBeenCalledWith("note.md", rev);
    expect(currentState.field(editorGutterDiffState).lines).toEqual([
      { text: "@@ -2,2 +2,2 @@", cssClass: "sb-revision-diff-hunk" },
      { text: "-old", cssClass: "sb-revision-diff-del" },
      { text: "+new", cssClass: "sb-revision-diff-add" },
    ]);
  });
});
