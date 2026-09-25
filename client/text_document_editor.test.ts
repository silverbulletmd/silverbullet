import { language } from "@codemirror/language";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";
import type { DocumentMeta } from "@silverbulletmd/silverbullet/type/index";
import { afterEach, expect, test, vi } from "vitest";
import type { Client } from "./client.ts";

vi.hoisted(() => {
  vi.stubGlobal("document", {
    documentElement: { style: {} },
    addEventListener() {},
  });
  vi.stubGlobal("navigator", { platform: "Linux", userAgent: "", vendor: "" });
});
vi.mock("./components/widget_sandbox_iframe.ts", () => ({
  prepareSandboxIFrame: () => {
    throw new Error("unexpected iframe");
  },
  getSandboxIFrame: () => {
    throw new Error("unexpected iframe");
  },
}));

const { TextDocumentEditor } = await import("./text_document_editor.ts");

function meta(name = "sample.rs", perm: "ro" | "rw" = "rw"): DocumentMeta {
  return {
    name,
    extension: name.split(".").pop()!,
    contentType: "application/octet-stream",
    size: 20,
    created: "",
    lastModified: "",
    perm,
    ref: name,
    tag: "document",
  };
}

function setup() {
  let state = EditorState.create({ doc: "previous valid page" });
  const editorDOM = {};
  const staleFrame = { remove: vi.fn() };
  const classes = new Set(["hide-cm"]);
  const parent = {
    children: [editorDOM, staleFrame],
    classList: { remove: (name: string) => classes.delete(name) },
  };
  const view = {
    get state() {
      return state;
    },
    setState: (next: EditorState) => {
      state = next;
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state;
    },
    dom: editorDOM,
    scrollDOM: { scrollTop: 0, scrollLeft: 0 },
    focus: vi.fn(),
    destroy: vi.fn(),
  };
  const writeDocument = vi.fn(async (_path: string, _bytes: Uint8Array) =>
    meta(),
  );
  const client = {
    editorView: view as unknown as EditorView,
    ui: {
      viewState: { uiOptions: {}, unsavedChanges: true },
      viewDispatch: vi.fn(),
      flashNotification: vi.fn(),
    },
    contentManager: {
      hostEditorMode: { kind: "page", pageName: "Previous" },
      documentEditor: null,
      saveTimeout: undefined,
    },
    bootConfig: { readOnly: false },
    config: { get: (_key: string, fallback: unknown) => fallback },
    clientSystem: {
      commandHook: {
        buildAllCommands: () =>
          new Map([
            [
              "Page action",
              {
                name: "Page action",
                key: "Ctrl-Alt-p",
                requireEditor: "page",
                run() {},
              },
            ],
            [
              "Text action",
              {
                name: "Text action",
                key: "Ctrl-Alt-t",
                requireEditor: "TextEditor",
                run() {},
              },
            ],
          ]),
      },
    },
    space: { writeDocument },
    dispatchAppEvent: vi.fn(async () => []),
    isReadOnlyMode: () => client.bootConfig.readOnly,
    currentPath: () => "sample.rs",
    save: vi.fn(async () => {}),
    rebuildEditorState: vi.fn(),
  };
  const editor = new TextDocumentEditor(
    parent as unknown as HTMLElement,
    client as unknown as Client,
  );
  return { client, editor, view, writeDocument, staleFrame, classes };
}

afterEach(() => vi.useRealTimers());

test("valid UTF-8 opens in the existing host with the loaded language and text commands", async () => {
  const { client, editor, view, staleFrame, classes } = setup();
  await editor.openFile(
    new TextEncoder().encode("fn main() {}"),
    meta(),
    undefined,
  );
  expect(client.editorView).toBe(view);
  expect(view.state.doc.toString()).toBe("fn main() {}");
  expect(view.state.facet(language)).not.toBeNull();
  expect(client.contentManager.hostEditorMode).toEqual(
    expect.objectContaining({ kind: "text-document", path: "sample.rs" }),
  );
  const bindings = view.state.facet(keymap).flat();
  expect(bindings.some((binding) => binding.key === "Ctrl-Alt-t")).toBe(true);
  expect(bindings.some((binding) => binding.key === "Ctrl-Alt-p")).toBe(false);
  expect(classes.has("hide-cm")).toBe(false);
  expect(staleFrame.remove).toHaveBeenCalledOnce();
});

test("invalid UTF-8 rejects before replacing a valid state or its mode", async () => {
  const { client, editor, view, staleFrame } = setup();
  const before = view.state;
  const beforeMode = client.contentManager.hostEditorMode;
  await expect(
    editor.openFile(new Uint8Array([0x66, 0x80]), meta(), undefined),
  ).rejects.toThrow();
  expect(view.state).toBe(before);
  expect(client.contentManager.hostEditorMode).toBe(beforeMode);
  expect(staleFrame.remove).not.toHaveBeenCalled();
});

test("a body that grows past the limit rejects before replacing the state", async () => {
  const { editor, view } = setup();
  const before = view.state;
  await expect(
    editor.openFile(new Uint8Array(5_242_881), meta(), undefined),
  ).rejects.toThrow();
  expect(view.state).toBe(before);
});

test("edits save exact UTF-8 and retain CRLF line endings", async () => {
  const { client, editor, view, writeDocument } = setup();
  await editor.openFile(
    new TextEncoder().encode("fn main() {}\r\n// café 🌿\r\n"),
    meta(),
    undefined,
  );
  view.dispatch({ changes: { from: 12, insert: " // saved" } });
  await editor.requestSave();
  expect(writeDocument).toHaveBeenCalledWith(
    "sample.rs",
    new TextEncoder().encode("fn main() {} // saved\r\n// café 🌿\r\n"),
  );
  expect(client.ui.viewDispatch).toHaveBeenCalledWith({
    type: "document-editor-saved",
  });
  expect(client.dispatchAppEvent).toHaveBeenCalledWith(
    "editor:documentSaved",
    "sample.rs",
    meta(),
  );
});

test("a leading UTF-8 BOM stays hidden while BOM and CRLF bytes round trip", async () => {
  const { editor, view, writeDocument } = setup();
  await editor.openFile(
    new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode("first\r\nsecond\r\n"),
    ]),
    meta("sample.txt"),
    undefined,
  );
  expect(view.state.doc.toString()).toBe("first\r\nsecond\r\n");
  view.dispatch({ changes: { from: 5, insert: " saved" } });
  await editor.requestSave();
  expect(Array.from(writeDocument.mock.calls[0][1])).toEqual([
    0xef,
    0xbb,
    0xbf,
    ...new TextEncoder().encode("first saved\r\nsecond\r\n"),
  ]);
});

test("queued saves retain the BOM policy of the document that created them", async () => {
  const { editor, view, writeDocument } = setup();
  const firstWrite = Promise.withResolvers<DocumentMeta>();
  writeDocument.mockReturnValueOnce(firstWrite.promise);
  await editor.openFile(
    new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("first")]),
    meta("first.txt"),
    undefined,
  );
  view.dispatch({ changes: { from: 5, insert: "!" } });
  const firstSave = editor.requestSave();
  await editor.openFile(
    new TextEncoder().encode("second"),
    meta("second.txt"),
    undefined,
  );
  view.dispatch({ changes: { from: 6, insert: "!" } });
  const secondSave = editor.requestSave();
  firstWrite.resolve(meta("first.txt"));
  await Promise.all([firstSave, secondSave]);

  expect(Array.from(writeDocument.mock.calls[0][1]).slice(0, 3)).toEqual([
    0xef, 0xbb, 0xbf,
  ]);
  expect(Array.from(writeDocument.mock.calls[1][1])).toEqual(
    Array.from(new TextEncoder().encode("second!")),
  );
});

test.each(["document", "space", "forced"])(
  "%s read-only prevents text writes",
  async (source) => {
    const { client, editor, view, writeDocument } = setup();
    client.bootConfig.readOnly = source === "space";
    Object.assign(client.ui.viewState.uiOptions, {
      forcedROMode: source === "forced",
    });
    await editor.openFile(
      new TextEncoder().encode("plain text"),
      meta("sample.txt", source === "document" ? "ro" : "rw"),
      undefined,
    );
    expect(view.state.readOnly).toBe(true);
    await editor.requestSave();
    expect(writeDocument).not.toHaveBeenCalled();
  },
);

test("save resolves only after storage confirms the write", async () => {
  const { editor, writeDocument, client } = setup();
  const writing = Promise.withResolvers<DocumentMeta>();
  writeDocument.mockReturnValue(writing.promise);
  await editor.openFile(
    new TextEncoder().encode("fn main() {}"),
    meta(),
    undefined,
  );
  let saved = false;
  const save = editor.requestSave().then(() => {
    saved = true;
  });
  await Promise.resolve();
  expect(saved).toBe(false);
  expect(client.ui.viewDispatch).not.toHaveBeenCalled();
  writing.resolve(meta());
  await save;
  expect(saved).toBe(true);
});

test("an older save cannot mark edits made during the write as saved", async () => {
  const { editor, view, writeDocument, client } = setup();
  const writing = Promise.withResolvers<DocumentMeta>();
  writeDocument.mockReturnValue(writing.promise);
  await editor.openFile(
    new TextEncoder().encode("fn main() {}"),
    meta(),
    undefined,
  );
  const save = editor.requestSave();
  view.dispatch({ changes: { from: 12, insert: " // newer edit" } });
  writing.resolve(meta());
  await save;
  expect(client.ui.viewDispatch).not.toHaveBeenCalledWith({
    type: "document-editor-saved",
  });
});

test("overlapping text saves reach storage in order", async () => {
  const { editor, view, writeDocument } = setup();
  const writing = Promise.withResolvers<DocumentMeta>();
  writeDocument.mockReturnValueOnce(writing.promise);
  await editor.openFile(
    new TextEncoder().encode("fn main() {}"),
    meta(),
    undefined,
  );
  const firstSave = editor.requestSave();
  await Promise.resolve();
  view.dispatch({ changes: { from: 12, insert: " // newer edit" } });
  const secondSave = editor.requestSave();
  await Promise.resolve();
  expect(writeDocument).toHaveBeenCalledTimes(1);
  writing.resolve(meta());
  await Promise.all([firstSave, secondSave]);
  expect(writeDocument).toHaveBeenNthCalledWith(
    2,
    "sample.rs",
    new TextEncoder().encode("fn main() {} // newer edit"),
  );
});

test("a restored buffer stays dirty while a conflicting snapshot is queued", async () => {
  const { editor, view, writeDocument, client } = setup();
  const alphaWrite = Promise.withResolvers<DocumentMeta>();
  const betaWrite = Promise.withResolvers<DocumentMeta>();
  writeDocument
    .mockReturnValueOnce(alphaWrite.promise)
    .mockReturnValueOnce(betaWrite.promise);
  await editor.openFile(
    new TextEncoder().encode("alpha"),
    meta("sample.txt"),
    undefined,
  );
  const alphaSave = editor.requestSave();
  view.dispatch({ changes: { from: 0, to: 5, insert: "beta" } });
  const betaSave = editor.requestSave();
  view.dispatch({ changes: { from: 0, to: 4, insert: "alpha" } });
  alphaWrite.resolve(meta("sample.txt"));
  await alphaSave;
  try {
    expect(client.ui.viewDispatch).not.toHaveBeenCalledWith({
      type: "document-editor-saved",
    });
  } finally {
    betaWrite.resolve(meta("sample.txt"));
    await betaSave;
  }
});

test("a finishing save cannot clear a different document's dirty state", async () => {
  const { editor, writeDocument, client } = setup();
  const writing = Promise.withResolvers<DocumentMeta>();
  writeDocument.mockReturnValue(writing.promise);
  await editor.openFile(
    new TextEncoder().encode("same text"),
    meta(),
    undefined,
  );
  const save = editor.requestSave();
  await editor.openFile(
    new TextEncoder().encode("same text"),
    meta("other.rs"),
    undefined,
  );
  writing.resolve(meta());
  await save;
  expect(client.ui.viewDispatch).not.toHaveBeenCalledWith({
    type: "document-editor-saved",
  });
});

test("a failed write rejects and retains the retry notification and timer", async () => {
  vi.useFakeTimers();
  const { editor, writeDocument, client } = setup();
  await editor.openFile(
    new TextEncoder().encode("fn main() {}"),
    meta(),
    undefined,
  );
  writeDocument.mockRejectedValue(new Error("storage unavailable"));
  await expect(editor.requestSave()).rejects.toThrow("storage unavailable");
  expect(client.ui.viewDispatch).not.toHaveBeenCalled();
  expect(client.ui.flashNotification).toHaveBeenCalledWith(
    "Could not save document, retrying again in 10 seconds",
    "error",
  );
  await vi.advanceTimersByTimeAsync(10_000);
  expect(client.save).toHaveBeenCalledOnce();
});

test("destroy releases the document without destroying the host EditorView", async () => {
  const { editor, view, writeDocument } = setup();
  await editor.openFile(
    new TextEncoder().encode("fn main() {}"),
    meta(),
    undefined,
  );
  await editor.destroy();
  await editor.requestSave();
  expect(view.destroy).not.toHaveBeenCalled();
  expect(view.state.doc.toString()).toBe("fn main() {}");
  expect(writeDocument).not.toHaveBeenCalled();
});
