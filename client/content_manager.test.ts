import { language } from "@codemirror/language";
import {
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  type TransactionSpec,
} from "@codemirror/state";
import {
  notFoundError,
  offlineError,
} from "@silverbulletmd/silverbullet/constants";
import type {
  DocumentMeta,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import { describe, expect, test, vi } from "vitest";
import type { Client } from "./client.ts";
import type { EditorMode } from "./codemirror/editor_state.ts";
import { loadLanguageFor } from "./languages.ts";
import type { MediaCapabilities } from "./media.ts";
import { MediaDocumentViewer } from "./media_document_viewer.ts";
import { PermissionDeniedError } from "./spaces/http_space_primitives.ts";
import { MediaTestElement, mediaTestDocument } from "./test_media_dom.ts";

const editorStateSpies = vi.hoisted(() => ({
  inactiveEditors: [] as string[],
  inactiveReadOnly: [] as Array<boolean | undefined>,
}));

// Mock the editor extension chain because it touches document at module
// load; ContentManager itself runs against real EditorState transactions.
vi.mock("./codemirror/editor_state.ts", async () => {
  const { Annotation, EditorState: RealEditorState } = await import(
    "@codemirror/state"
  );
  const { buildExtendedMarkdownLanguage } = await import(
    "./markdown_parser/parser.ts"
  );
  return {
    buildMarkdownLanguageExtension: () => [buildExtendedMarkdownLanguage()],
    createEditorState: (
      _client: unknown,
      mode: EditorMode,
      text: string,
      readOnly: boolean,
      selection?: EditorSelection,
    ) =>
      RealEditorState.create({
        doc: text,
        selection,
        extensions: [
          RealEditorState.readOnly.of(readOnly),
          mode.kind === "text-document" ? (mode.language ?? []) : [],
        ],
      }),
    createInactiveEditorState: (
      client: { contentManager?: { documentEditor?: { name?: string } } },
      sourceState: EditorState,
      readOnly?: boolean,
    ) => {
      editorStateSpies.inactiveEditors.push(
        client.contentManager?.documentEditor?.name ?? "",
      );
      editorStateSpies.inactiveReadOnly.push(readOnly);
      return RealEditorState.create({
        doc: sourceState.doc,
        selection: sourceState.selection,
        extensions: [RealEditorState.readOnly.of(true)],
      });
    },
    externalUpdate: Annotation.define<boolean>(),
    forceParseVisibleRegion: () => {},
  };
});

const { ContentManager } = await import("./content_manager.ts");
const { IFrameDocumentEditor } = await import("./document_editor.ts");

const editorParent = {
  children: [] as Element[],
  classList: { add() {}, remove() {} },
};

// Provide the DOM shape used by the enriched-meta decoration refresh.
(
  globalThis as unknown as {
    document: { body: unknown; baseURI: string; getElementById: () => unknown };
  }
).document = {
  baseURI: "http://example.test/",
  getElementById: () => editorParent,
  body: {
    className: "",
    removeAttribute(this: { className: string }, name: string) {
      if (name === "class") this.className = "";
    },
  },
};

// Minimal stand-in for EditorView: real EditorState + real transaction
// application (state.update), so ChangeSet/annotation semantics are
// genuine -- just no DOM rendering.
function makeEditorViewStub(initialDoc: string) {
  let state = EditorState.create({ doc: initialDoc });
  const scrollDOM = { scrollTop: 0, scrollLeft: 0, clientHeight: 100 };
  const dispatched: TransactionSpec[] = [];
  return {
    get state() {
      return state;
    },
    setState(newState: EditorState) {
      state = newState;
      scrollDOM.scrollTop = 0;
      scrollDOM.scrollLeft = 0;
    },
    dispatch(spec: TransactionSpec) {
      dispatched.push(spec);
      state = state.update(spec).state;
    },
    dispatched,
    contentDOM: { blur() {} },
    dom: {},
    focus() {},
    scrollDOM,
    lineBlockAt: () => ({ top: 0, bottom: 20 }),
  };
}

type ReadPageResult = { text: string; meta: PageMeta };
type ReadDocumentResult = {
  data: Uint8Array;
  meta: DocumentMeta;
};

function makeClientStub(opts: {
  initialDoc: string;
  readPage: () => Promise<ReadPageResult>;
  readDocument?: (path: string) => Promise<ReadDocumentResult>;
  getDocumentMeta?: (path: string) => Promise<DocumentMeta>;
  writeDocument?: (path: string, data: Uint8Array) => Promise<DocumentMeta>;
  writePage?: (name: string, text: string) => Promise<PageMeta>;
  hasFullIndexCompleted?: () => Promise<boolean>;
  getObjectByRef?: () => Promise<PageMeta | undefined>;
  flashNotification?: (message: string, type?: string) => void;
  documentExtensions?: string[];
}) {
  const editorView = makeEditorViewStub(opts.initialDoc);
  const viewState: {
    current?: { path: string; meta?: PageMeta };
    unsavedChanges: boolean;
  } = {
    current: undefined,
    unsavedChanges: false,
  };
  let currentPathValue = "";
  const dispatchedEvents: { name: string; args: unknown[] }[] = [];
  const viewDispatched: { type: string; [key: string]: unknown }[] = [];
  const watchedFiles: string[] = [];
  const unwatchedFiles: string[] = [];

  const declaredBases: { path: string; baseText: string }[] = [];
  // Set by a test that needs the declare to stay in flight while it does
  // something else (e.g. navigate away).
  let blockDeclare: Promise<void> | undefined;

  const client = {
    contentManager: undefined as unknown as InstanceType<typeof ContentManager>,
    rebuildEditorState: () => client.contentManager.rebuildEditorState(),
    save: (immediate = false) => client.contentManager.save(immediate),
    bootConfig: { readOnly: false },
    editorView,
    markdownLanguageCompartment: new Compartment(),
    viewState,
    declaredBases,
    watchedFiles,
    unwatchedFiles,
    set blockDeclareOn(p: Promise<void>) {
      blockDeclare = p;
    },
    declareDivergentBase: async (path: string, baseText: string) => {
      declaredBases.push({ path, baseText });
      if (blockDeclare) await blockDeclare;
    },
    set currentPathValue(v: string) {
      currentPathValue = v;
    },
    ui: {
      viewState,
      flashNotification: opts.flashNotification ?? (() => {}),
      viewDispatch: (action: {
        type: string;
        path?: string;
        meta?: PageMeta;
      }) => {
        viewDispatched.push(action);
        if (
          (action.type === "page-loaded" ||
            action.type === "document-editor-loaded") &&
          action.path
        ) {
          viewState.current = { path: action.path, meta: action.meta };
          currentPathValue = action.path;
        }
        if (action.type === "document-editor-saved")
          viewState.unsavedChanges = false;
        if (action.type === "update-current-page-meta" && viewState.current) {
          viewState.current = { ...viewState.current, meta: action.meta };
        }
      },
    },
    space: {
      readPage: opts.readPage,
      readDocument: opts.readDocument,
      getDocumentMeta:
        opts.getDocumentMeta ??
        (async (path: string) =>
          documentMeta(
            path,
            path.endsWith(".zip") ? "application/zip" : "application/pdf",
          )),
      writeDocument:
        opts.writeDocument ?? (async (path: string) => documentMeta(path)),
      writePage:
        opts.writePage ?? (async () => pageMeta("2026-01-01T00:00:00.000")),
      unwatchFile: (path: string) => unwatchedFiles.push(path),
      watchFile: (path: string) => watchedFiles.push(path),
    },
    objectIndex: {
      hasFullIndexCompleted: opts.hasFullIndexCompleted ?? (async () => false),
      getObjectByRef: opts.getObjectByRef ?? (async () => undefined),
    },
    widgetCache: { clearPrewarm: () => {} },
    pageMetaAugmenter: { setAugmentation: async () => {} },
    clientSystem: {
      documentEditorHook: {
        documentEditors: new Map([
          [
            "test",
            {
              extensions: opts.documentExtensions ?? ["pdf"],
              callback: async () => ({ html: "" }),
            },
          ],
        ]),
      },
    },
    eventHook: {
      dispatchEvent: async (name: string, ...args: unknown[]) => {
        dispatchedEvents.push({ name, args });
        return [];
      },
    },
    canDeferExternalUpdate: () => true,
    isReadOnlyMode: () => false,
    currentPageMeta: () => viewState.current?.meta,
    dispatchAppEvent: async () => [],
    openUrl: vi.fn(),
    currentPath: () => currentPathValue,
    currentName: () => currentPathValue.replace(/\.md$/, ""),
    dispatchedEvents,
    viewDispatched,
  };
  return client;
}

function documentMeta(
  name: string,
  contentType = "application/octet-stream",
  size = 20,
): DocumentMeta {
  return {
    name,
    contentType,
    size,
    extension: name.split(".").pop()!,
    created: "",
    lastModified: "",
    perm: "rw",
    ref: name,
    tag: "document",
  };
}

describe("ContentManager document resolution and host lifecycle", () => {
  function setupDocuments(
    options: Partial<Parameters<typeof makeClientStub>[0]> = {},
    capabilities: MediaCapabilities = { supports: () => false },
  ) {
    editorStateSpies.inactiveEditors.length = 0;
    editorStateSpies.inactiveReadOnly.length = 0;
    const client = makeClientStub({
      initialDoc: "Current page",
      readPage: async () => ({ text: "Next page", meta: pageMeta("") }),
      getDocumentMeta: async (path) => documentMeta(path),
      readDocument: async (path) => ({
        data: new TextEncoder().encode("fn main() {}"),
        meta: documentMeta(path),
      }),
      documentExtensions: [],
      ...options,
    });
    client.currentPathValue = "Current.md";
    client.viewState.current = { path: "Current.md", meta: pageMeta("") };
    const cm = new ContentManager(client as unknown as Client, capabilities);
    client.contentManager = cm;
    return { client, cm };
  }

  test("host media reads metadata only and reloads the same kind with a fresh URL", async () => {
    const dom = mediaTestDocument();
    vi.stubGlobal("document", { ...document, ...dom });
    let modified = "first";
    const readDocument = vi.fn(async () => {
      throw new Error("must not read bytes");
    });
    const { client, cm } = setupDocuments(
      {
        getDocumentMeta: async (path) => ({
          ...documentMeta(path, "video/mp4", 100_000_000),
          lastModified: modified,
        }),
        readDocument,
      },
      { supports: () => true },
    );
    try {
      await cm.loadDocumentEditor({ path: "clip.mp4" });
      const viewer = cm.documentEditor;
      expect(viewer).toBeInstanceOf(MediaDocumentViewer);
      expect(cm.hostEditorMode).toBeNull();
      expect(editorStateSpies.inactiveEditors).toContain("MediaViewer");
      expect(dom.parent.classList.contains("hide-cm")).toBe(true);
      expect(dom.parent.find("video")?.getAttribute("src")).toContain(
        "clip.mp4?v=first",
      );
      modified = "second";
      await cm.loadDocumentEditor({ path: "clip.mp4" });
      expect(cm.documentEditor).toBe(viewer);
      expect(dom.parent.children).toHaveLength(1);
      expect(dom.parent.find("video")?.getAttribute("src")).toContain(
        "clip.mp4?v=second",
      );
      expect(readDocument).not.toHaveBeenCalled();
      expect(client.watchedFiles).toEqual(["clip.mp4", "clip.mp4"]);
      expect(client.dispatchedEvents).toContainEqual({
        name: "editor:documentReloaded",
        args: ["clip.mp4", "clip.mp4"],
      });
      cm.switchToPageEditor();
      expect(dom.parent.children).toHaveLength(0);
      expect(dom.parent.classList.contains("hide-cm")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("changing media kind destroys the previous viewer before mounting the next", async () => {
    const dom = mediaTestDocument();
    vi.stubGlobal("document", { ...document, ...dom });
    const { cm } = setupDocuments(
      {
        getDocumentMeta: async (path) =>
          documentMeta(
            path,
            path.endsWith(".mp4") ? "video/mp4" : "audio/mpeg",
          ),
      },
      { supports: () => true },
    );
    try {
      await cm.loadDocumentEditor({ path: "clip.mp4" });
      const viewer = cm.documentEditor!;
      const destroy = vi.spyOn(viewer, "destroy");
      const video = dom.parent.find("video")!;
      await cm.loadDocumentEditor({ path: "sound.mp3" });
      expect(cm.documentEditor).not.toBe(viewer);
      expect(destroy).toHaveBeenCalledOnce();
      expect(video.pause).toHaveBeenCalledOnce();
      expect(dom.parent.find("video")).toBeUndefined();
      expect(dom.parent.find("audio")).toBeDefined();
      expect(dom.parent.classList.contains("hide-cm")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("inactive document state uses the incoming document permission", async () => {
    const dom = mediaTestDocument();
    vi.stubGlobal("document", { ...document, ...dom });
    let perm: "ro" | "rw" = "ro";
    const { cm } = setupDocuments(
      {
        getDocumentMeta: async (path) => ({
          ...documentMeta(path, "video/mp4"),
          perm,
        }),
      },
      { supports: () => true },
    );
    try {
      await cm.loadDocumentEditor({ path: "clip.mp4" });
      expect(editorStateSpies.inactiveReadOnly.at(-1)).toBe(true);
      perm = "rw";
      await cm.loadDocumentEditor({ path: "clip.mp4" });
      expect(editorStateSpies.inactiveReadOnly.at(-1)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("media waits for an active iframe save before replacing its DOM", async () => {
    const dom = mediaTestDocument();
    vi.stubGlobal("document", { ...document, ...dom });
    const { client, cm } = setupDocuments(
      { getDocumentMeta: async (path) => documentMeta(path, "image/png") },
      { supports: () => true },
    );
    const previous = new IFrameDocumentEditor(
      dom.parent as unknown as HTMLElement,
      client as unknown as Client,
      () => {},
    );
    previous.name = "Previous";
    const frame = new MediaTestElement("iframe");
    previous.iframe = frame as unknown as HTMLIFrameElement;
    dom.parent.appendChild(frame);
    previous.savePromise = Promise.withResolvers<void>();
    cm.documentEditor = previous;
    const destroy = vi.spyOn(previous, "destroy");
    try {
      const opening = cm.loadDocumentEditor({ path: "sample.png" }).then(
        () => undefined,
        (error: unknown) => error,
      );
      await vi.waitFor(() => expect(destroy).toHaveBeenCalledOnce());
      expect(dom.parent.children).toEqual([frame]);
      previous.savePromise.resolve();
      expect(await opening).toBeUndefined();
      expect(dom.parent.find("iframe")).toBeUndefined();
      expect(dom.parent.find("img")).toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("the image-viewer plug retains precedence over browser image support", async () => {
    const { client, cm } = setupDocuments(
      {
        documentExtensions: ["png"],
        getDocumentMeta: async (path) => documentMeta(path, "image/png"),
        readDocument: async (path) => ({
          data: new Uint8Array([1]),
          meta: documentMeta(path, "image/png"),
        }),
      },
      { supports: () => true },
    );
    const init = vi
      .spyOn(IFrameDocumentEditor.prototype, "init")
      .mockImplementation(async function (
        this: InstanceType<typeof IFrameDocumentEditor>,
        resolution,
      ) {
        this.name = resolution.name;
        this.extension = resolution.extension;
        this.iframe = {
          contentWindow: { postMessage() {} },
          remove() {},
        } as unknown as HTMLIFrameElement;
      });
    try {
      await cm.loadDocumentEditor({ path: "sample.png" });
      expect(cm.documentEditor).toBeInstanceOf(IFrameDocumentEditor);
      expect(client.currentPath()).toBe("sample.png");
    } finally {
      init.mockRestore();
    }
  });

  test.each(["valid", "invalid"])(
    "%s text validation precedes the active iframe's save and teardown",
    async (content) => {
      await loadLanguageFor("rs");
      vi.useFakeTimers();
      const { client, cm } = setupDocuments({
        readDocument: async (path) => ({
          data:
            content === "valid"
              ? new TextEncoder().encode("fn main() {}")
              : new Uint8Array([0xff]),
          meta: documentMeta(path),
        }),
      });
      const messages: unknown[] = [];
      const frame = {
        contentWindow: {
          postMessage: (message: unknown) => messages.push(message),
        },
        remove: vi.fn(() => {
          editorParent.children = editorParent.children.filter(
            (child) => child !== (frame as unknown as Element),
          );
        }),
      };
      const previous = new IFrameDocumentEditor(
        editorParent as unknown as HTMLElement,
        client as unknown as Client,
        () => {},
      );
      previous.name = "ExampleEditor";
      previous.iframe = frame as unknown as HTMLIFrameElement;
      client.currentPathValue = "drawing.custom";
      client.viewState.current = {
        path: "drawing.custom",
        meta: documentMeta("drawing.custom"),
      };
      editorParent.children = [
        client.editorView.dom as HTMLElement,
        previous.iframe,
      ];
      cm.documentEditor = previous;
      cm.hostEditorMode = null;
      client.viewState.unsavedChanges = true;
      const destroy = vi.spyOn(previous, "destroy");
      try {
        const opening = cm.loadDocumentEditor({ path: "sample.rs" });
        const outcome = opening.then(
          () => "opened",
          (error: Error) => error.message,
        );
        await vi.advanceTimersByTimeAsync(0);
        expect(frame.remove).not.toHaveBeenCalled();
        expect(cm.documentEditor).toBe(previous);
        expect(client.editorView.state.doc.toString()).toBe("Current page");
        expect(messages).toEqual([{ type: "request-save", internal: false }]);
        if (content === "valid") {
          expect(destroy).toHaveBeenCalledOnce();
          previous.savePromise!.resolve();
          expect(await outcome).toBe("opened");
          expect(frame.remove).toHaveBeenCalledOnce();
          expect(cm.documentEditor?.name).toBe("TextEditor");
          expect(client.editorView.state.doc.toString()).toBe("fn main() {}");
        } else {
          expect(await outcome).toBe("Opened externally");
          expect(destroy).not.toHaveBeenCalled();
          expect(cm.hostEditorMode).toBeNull();
          previous.savePromise!.resolve();
        }
      } finally {
        editorParent.children = [];
        vi.useRealTimers();
      }
    },
  );

  test.each([
    ["archive.bin", "application/octet-stream", 6_000_000],
    ["clip.mp4", "video/mp4", 20],
    ["archive.zip", "application/zip", 20],
  ])(
    "%s fetches metadata but never fetches external bytes",
    async (path, mime, size) => {
      const getDocumentMeta = vi.fn(async () => documentMeta(path, mime, size));
      const readDocument = vi.fn(async () => {
        throw new Error("must not read bytes");
      });
      const { client, cm } = setupDocuments({ getDocumentMeta, readDocument });
      await expect(
        cm.loadDocumentEditor({ path: path as `${string}.${string}` }),
      ).rejects.toThrow("Opened externally");
      expect(getDocumentMeta).toHaveBeenCalledWith(path, "cheap");
      expect(readDocument).not.toHaveBeenCalled();
      expect(client.openUrl).toHaveBeenCalledOnce();
      expect(client.editorView.state.doc.toString()).toBe("Current page");
      expect(client.unwatchedFiles).toEqual([]);
    },
  );

  test("text navigation loads metadata before bytes and keeps document events and watches", async () => {
    const order: string[] = [];
    const { client, cm } = setupDocuments({
      getDocumentMeta: async (path) => {
        order.push("meta");
        return documentMeta(path);
      },
      readDocument: async (path) => {
        order.push("bytes");
        return {
          data: new TextEncoder().encode("fn main() {}"),
          meta: documentMeta(path),
        };
      },
    });
    await cm.loadDocumentEditor({ path: "sample.rs" });
    expect(order).toEqual(["meta", "bytes"]);
    expect(cm.documentEditor?.name).toBe("TextEditor");
    expect(cm.hostEditorMode).toEqual(
      expect.objectContaining({ kind: "text-document", path: "sample.rs" }),
    );
    expect(client.editorView.state.doc.toString()).toBe("fn main() {}");
    expect(client.unwatchedFiles).toEqual(["Current.md"]);
    expect(client.watchedFiles).toEqual(["sample.rs"]);
    expect(client.viewState.current?.path).toBe("sample.rs");
    expect(client.dispatchedEvents).toContainEqual({
      name: "editor:documentLoaded",
      args: ["sample.rs", "Current.md"],
    });
    expect(
      client.dispatchedEvents.some((event) =>
        event.name.startsWith("editor:page"),
      ),
    ).toBe(false);
  });

  test("an invalid UTF-8 candidate preserves a prior text editor and never writes replacement characters", async () => {
    const writeDocument = vi.fn(async (path: string) => documentMeta(path));
    const { client, cm } = setupDocuments({
      readDocument: async (path) => ({
        data:
          path === "sample.rs"
            ? new TextEncoder().encode("fn main() {}")
            : new Uint8Array([0xff]),
        meta: documentMeta(path),
      }),
      writeDocument,
    });
    await cm.loadDocumentEditor({ path: "sample.rs" });
    const editor = cm.documentEditor;
    const state = client.editorView.state;
    await expect(cm.loadDocumentEditor({ path: "binary.rs" })).rejects.toThrow(
      "Opened externally",
    );
    expect(cm.documentEditor).toBe(editor);
    expect(client.editorView.state).toBe(state);
    expect(cm.hostEditorMode).toEqual(
      expect.objectContaining({ path: "sample.rs" }),
    );
    expect(client.viewState.current?.path).toBe("sample.rs");
    expect(client.unwatchedFiles).not.toContain("sample.rs");
    expect(writeDocument).not.toHaveBeenCalled();
  });

  test("text-to-text navigation reuses its implementation across extensions", async () => {
    const { client, cm } = setupDocuments();
    await cm.loadDocumentEditor({ path: "sample.rs" });
    const editor = cm.documentEditor;
    await cm.loadDocumentEditor({ path: "sample.txt" });
    expect(cm.documentEditor).toBe(editor);
    expect(cm.documentEditor?.extension).toBe("txt");
    expect(client.editorView.state.facet(language)).toBeNull();
  });

  test("a newly matched plug claims a formerly text extension and its failure surfaces", async () => {
    const { client, cm } = setupDocuments();
    await cm.loadDocumentEditor({ path: "sample.rs" });
    const editor = cm.documentEditor;
    const callback = vi.fn(async () => {
      throw new Error("Couldn't find plug resource");
    });
    client.clientSystem.documentEditorHook.documentEditors.set(
      "SpecialEditor",
      { extensions: ["rs"], callback },
    );
    await expect(cm.loadDocumentEditor({ path: "sample.rs" })).rejects.toThrow(
      "Couldn't find plug resource",
    );
    expect(callback).toHaveBeenCalledOnce();
    expect(client.openUrl).not.toHaveBeenCalled();
    expect(cm.documentEditor).toBe(editor);
  });

  test("plug reuse follows callback identity rather than extension", async () => {
    const { client, cm } = setupDocuments();
    const messages: unknown[] = [];
    const init = vi
      .spyOn(IFrameDocumentEditor.prototype, "init")
      .mockImplementation(async function (
        this: InstanceType<typeof IFrameDocumentEditor>,
        resolution,
      ) {
        this.name = resolution.name;
        this.extension = resolution.extension;
        this.iframe = {
          contentWindow: {
            postMessage: (message: unknown) => messages.push(message),
          },
          remove() {},
        } as unknown as HTMLIFrameElement;
      });
    try {
      const callback = async () => ({ html: "" });
      client.clientSystem.documentEditorHook.documentEditors.set(
        "SpecialEditor",
        { extensions: ["rs", "txt"], callback },
      );
      await cm.loadDocumentEditor({ path: "sample.rs" });
      expect(editorStateSpies.inactiveEditors).toContain("SpecialEditor");
      const first = cm.documentEditor;
      await cm.loadDocumentEditor({ path: "sample.txt" });
      expect(cm.documentEditor).toBe(first);
      expect(init).toHaveBeenCalledTimes(1);
      client.clientSystem.documentEditorHook.documentEditors.set(
        "SpecialEditor",
        { extensions: ["txt"], callback: async () => ({ html: "new" }) },
      );
      await cm.loadDocumentEditor({ path: "sample.txt" });
      expect(cm.documentEditor).not.toBe(first);
      expect(init).toHaveBeenCalledTimes(2);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: "file-open",
          data: expect.objectContaining({
            meta: expect.objectContaining({ name: "sample.txt" }),
          }),
        }),
      );
    } finally {
      init.mockRestore();
    }
  });

  test("leaving text waits for the write before replacing the host state", async () => {
    const writing = Promise.withResolvers<DocumentMeta>();
    const writeDocument = vi.fn(() => writing.promise);
    const { client, cm } = setupDocuments({ writeDocument });
    await cm.loadDocumentEditor({ path: "sample.rs" });
    client.editorView.dispatch({ changes: { from: 12, insert: " // saved" } });
    client.viewState.unsavedChanges = true;
    const navigation = cm.loadPage({ path: "Next.md" }, false);
    await vi.waitFor(() => expect(writeDocument).toHaveBeenCalledOnce());
    expect(client.viewState.current?.path).toBe("sample.rs");
    expect(client.editorView.state.doc.toString()).toBe(
      "fn main() {} // saved",
    );
    writing.resolve(documentMeta("sample.rs"));
    await navigation;
    expect(client.editorView.state.doc.toString()).toBe("Next page");
    expect(cm.documentEditor).toBeNull();
    expect(cm.hostEditorMode).toEqual({ kind: "page", pageName: "Next" });
    expect(writeDocument).toHaveBeenCalledWith(
      "sample.rs",
      new TextEncoder().encode("fn main() {} // saved"),
    );
  });

  test("a rejected text write rejects save and blocks navigation", async () => {
    const { client, cm } = setupDocuments({
      writeDocument: async () => {
        throw new Error("storage unavailable");
      },
    });
    await cm.loadDocumentEditor({ path: "sample.rs" });
    client.viewState.unsavedChanges = true;
    try {
      await expect(cm.loadPage({ path: "Next.md" }, false)).rejects.toThrow(
        "storage unavailable",
      );
      expect(client.viewState.current?.path).toBe("sample.rs");
      expect(client.editorView.state.doc.toString()).toBe("fn main() {}");
    } finally {
      clearTimeout(cm.saveTimeout);
    }
  });

  test("navigation also flushes edits made while the first text write is pending", async () => {
    const writing = Promise.withResolvers<DocumentMeta>();
    const writeDocument = vi.fn(() => writing.promise);
    const { client, cm } = setupDocuments({ writeDocument });
    await cm.loadDocumentEditor({ path: "sample.rs" });
    client.viewState.unsavedChanges = true;
    const navigation = cm.loadPage({ path: "Next.md" }, false);
    await vi.waitFor(() => expect(writeDocument).toHaveBeenCalledOnce());
    client.editorView.dispatch({
      changes: { from: 12, insert: " // during save" },
    });
    writing.resolve(documentMeta("sample.rs"));
    await navigation;
    expect(writeDocument).toHaveBeenLastCalledWith(
      "sample.rs",
      new TextEncoder().encode("fn main() {} // during save"),
    );
    expect(client.viewState.unsavedChanges).toBe(false);
  });

  test.each(["navigation", "save", "concurrent saves"])(
    "%s drains alpha → beta → alpha before returning",
    async (operation) => {
      let diskText = "alpha";
      const writes: { text: string; finish: () => void }[] = [];
      const { client, cm } = setupDocuments({
        readDocument: async (path) => ({
          data: new TextEncoder().encode(diskText),
          meta: documentMeta(path),
        }),
        writeDocument: (path, bytes) => {
          const write = Promise.withResolvers<DocumentMeta>();
          const text = new TextDecoder().decode(bytes);
          writes.push({
            text,
            finish: () => {
              diskText = text;
              write.resolve(documentMeta(path));
            },
          });
          return write.promise;
        },
      });
      try {
        await cm.loadDocumentEditor({ path: "sample.txt" });
        vi.useFakeTimers();
        const editor = cm.documentEditor!;
        client.viewState.unsavedChanges = true;
        let boundaryFinished = false;
        const alphaSave =
          operation !== "navigation"
            ? cm.save(true)
            : Promise.resolve(editor.requestSave());
        let boundary =
          operation !== "navigation"
            ? alphaSave.then(() => {
                boundaryFinished = true;
              })
            : undefined;
        await vi.advanceTimersByTimeAsync(0);
        client.editorView.dispatch({
          changes: { from: 0, to: 5, insert: "beta" },
        });
        client.viewState.unsavedChanges = true;
        const betaSave =
          operation === "concurrent saves"
            ? cm.save(true)
            : editor.requestSave();
        await vi.advanceTimersByTimeAsync(0);
        client.editorView.dispatch({
          changes: { from: 0, to: 4, insert: "alpha" },
        });
        client.viewState.unsavedChanges = true;
        writes[0].finish();
        await vi.advanceTimersByTimeAsync(0);
        if (operation === "navigation") {
          boundary = cm.loadPage({ path: "Next.md" }, false).then(() => {
            boundaryFinished = true;
          });
          await vi.advanceTimersByTimeAsync(0);
        }
        const returnedBeforeQueuedWrite = boundaryFinished;
        writes[1].finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(writes.map((write) => write.text)).toEqual([
          "alpha",
          "beta",
          "alpha",
        ]);
        writes[2].finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(boundaryFinished).toBe(true);
        await Promise.all([alphaSave, betaSave, boundary]);

        expect(diskText).toBe("alpha");
        expect(returnedBeforeQueuedWrite).toBe(false);
        expect(writes.map((write) => write.text)).toEqual([
          "alpha",
          "beta",
          "alpha",
        ]);
        expect(client.viewState.unsavedChanges).toBe(false);
        expect(client.viewState.current?.path).toBe(
          operation === "navigation" ? "Next.md" : "sample.txt",
        );
      } finally {
        vi.useRealTimers();
      }
    },
  );
});

describe("ContentManager host editor rebuilds", () => {
  test("Markdown reconfiguration leaves a text document unchanged", async () => {
    const client = makeClientStub({
      initialDoc: "fn main() {}",
      readPage: async () => {
        throw new Error("unexpected read");
      },
    });
    const cm = new ContentManager(client as unknown as Client);
    cm.hostEditorMode = {
      kind: "text-document",
      path: "sample.rs",
      language: await loadLanguageFor("rs"),
    };
    cm.rebuildEditorState();
    client.editorView.dispatch({
      effects: StateEffect.appendConfig.of(
        client.markdownLanguageCompartment.of([]),
      ),
    });
    const previous = client.editorView.state;
    cm.reconfigureLanguage();
    expect(client.editorView.state).toBe(previous);
  });

  test("Markdown reconfiguration still updates the active page", () => {
    const client = makeClientStub({
      initialDoc: "# Heading",
      readPage: async () => {
        throw new Error("unexpected read");
      },
    });
    const cm = new ContentManager(client as unknown as Client);
    client.editorView.dispatch({
      effects: StateEffect.appendConfig.of(
        client.markdownLanguageCompartment.of([]),
      ),
    });
    cm.reconfigureLanguage();
    expect(client.editorView.state.facet(language)?.name).toBe("markdown");
  });

  test("retains text language, selection, read-only and scroll on rebuild", async () => {
    const client = makeClientStub({
      initialDoc: "fn main() {}",
      readPage: async () => {
        throw new Error("unexpected read");
      },
    });
    const cm = new ContentManager(client as unknown as Client);
    const rust = await loadLanguageFor("rs");
    cm.hostEditorMode = {
      kind: "text-document",
      path: "sample.rs",
      language: rust,
    };
    client.viewState.current = {
      path: "sample.rs",
      meta: { ...pageMeta(""), perm: "ro" },
    };
    client.editorView.dispatch({ selection: EditorSelection.range(3, 7) });
    client.editorView.scrollDOM.scrollTop = 150;
    client.editorView.scrollDOM.scrollLeft = 80;

    cm.rebuildEditorState();

    expect(client.editorView.state.sliceDoc()).toBe("fn main() {}");
    expect(client.editorView.state.facet(language)).toBe(rust);
    expect(client.editorView.state.selection.main.anchor).toBe(3);
    expect(client.editorView.state.selection.main.head).toBe(7);
    expect(client.editorView.state.readOnly).toBe(true);
    expect(client.editorView.scrollDOM.scrollTop).toBe(150);
    expect(client.editorView.scrollDOM.scrollLeft).toBe(80);
  });

  test("an inactive host rebuild removes its previous language", async () => {
    const client = makeClientStub({
      initialDoc: "hello",
      readPage: async () => {
        throw new Error("unexpected read");
      },
    });
    const cm = new ContentManager(client as unknown as Client);
    client.editorView.setState(
      EditorState.create({
        doc: "fn main() {}",
        extensions: [(await loadLanguageFor("rs"))!],
      }),
    );
    cm.hostEditorMode = null;
    cm.rebuildEditorState();
    expect(client.editorView.state.facet(language)).toBeNull();
  });
});

describe("ContentManager failed loads", () => {
  test("offline page navigation leaves the current editor untouched", async () => {
    const client = makeClientStub({
      initialDoc: "Keep this page\n",
      readPage: async () => {
        throw offlineError;
      },
    });
    client.currentPathValue = "Current.md";
    client.viewState.current = {
      path: "Current.md",
      meta: pageMeta("2026-01-01T00:00:00.000"),
    };
    const cm = new ContentManager(client as unknown as Client);

    await expect(cm.loadPage({ path: "Other.md" }, false)).rejects.toThrow(
      offlineError.message,
    );

    expect(client.editorView.state.sliceDoc()).toBe("Keep this page\n");
    expect(client.viewState.current.path).toBe("Current.md");
    expect(client.viewDispatched).not.toContainEqual(
      expect.objectContaining({ type: "page-loaded", path: "Other.md" }),
    );
    expect(client.unwatchedFiles).not.toContain("Current.md");
  });

  test("a confirmed missing page still opens as a new empty page", async () => {
    const client = makeClientStub({
      initialDoc: "Previous page\n",
      readPage: async () => {
        throw notFoundError;
      },
    });
    client.currentPathValue = "New.md";
    const cm = new ContentManager(client as unknown as Client);

    await cm.loadPage({ path: "New.md" }, false);

    expect(client.editorView.state.sliceDoc()).toBe("");
    expect(cm.hostEditorMode).toEqual({ kind: "page", pageName: "New" });
    expect(client.viewDispatched).toContainEqual(
      expect.objectContaining({ type: "page-loaded", path: "New.md" }),
    );
  });

  test("a failed document read does not switch away from the current editor", async () => {
    const client = makeClientStub({
      initialDoc: "Keep this page\n",
      readPage: async () => ({
        text: "Keep this page\n",
        meta: pageMeta("2026-01-01T00:00:00.000"),
      }),
      readDocument: async () => {
        throw offlineError;
      },
    });
    client.currentPathValue = "Current.md";
    const cm = new ContentManager(client as unknown as Client);
    const switchEditor = vi
      .spyOn(cm, "switchToDocumentEditor")
      .mockImplementation(async () => {
        cm.documentEditor = {
          openFile: () => {},
        } as unknown as typeof cm.documentEditor;
      });

    await expect(
      cm.loadDocumentEditor({ path: "Attachment.pdf" }),
    ).rejects.toThrow(offlineError.message);

    expect(switchEditor).not.toHaveBeenCalled();
    expect(client.editorView.state.sliceDoc()).toBe("Keep this page\n");
  });

  test("an unsupported document opens externally without reading it into memory", async () => {
    const readDocument = vi.fn(async () => {
      throw new Error("must not read");
    });
    const client = makeClientStub({
      initialDoc: "Keep this page\n",
      readPage: async () => ({
        text: "Keep this page\n",
        meta: pageMeta("2026-01-01T00:00:00.000"),
      }),
      readDocument,
      documentExtensions: ["pdf"],
    });
    client.currentPathValue = "Current.md";
    const cm = new ContentManager(client as unknown as Client);

    await expect(
      cm.loadDocumentEditor({ path: "Archive.zip" }),
    ).rejects.toThrow("Opened externally");

    expect(readDocument).not.toHaveBeenCalled();
    expect(client.openUrl).toHaveBeenCalledOnce();
    expect(client.editorView.state.sliceDoc()).toBe("Keep this page\n");
  });
});

function pageMeta(lastModified: string): PageMeta {
  return {
    name: "index",
    tags: ["page"],
    created: "",
    lastModified,
    perm: "rw",
  } as PageMeta;
}

describe("ContentManager.loadPage base tracking (regression)", () => {
  test("same-page reload merges against the previous disk text, not the newly-fetched one", async () => {
    let diskText = "hello world\nsecond\nthird\n";
    let diskModified = "2026-01-01T00:00:00.000";
    const client = makeClientStub({
      initialDoc: "",
      readPage: async () => ({ text: diskText, meta: pageMeta(diskModified) }),
    });
    client.currentPathValue = "index.md";
    const cm = new ContentManager(client as unknown as Client);

    await cm.loadPage({ path: "index.md" }, false);
    expect(client.editorView.state.sliceDoc()).toBe(
      "hello world\nsecond\nthird\n",
    );

    // An unsaved local edit sits in the editor -- stale relative to the disk
    // change below, exactly the situation "Editor: Reload" or the
    // first-sync-complete auto-reload can hit. It rewrites the first line,
    // clear of the append below, so the two merge instead of deferring.
    client.editorView.dispatch({
      changes: { from: 0, to: 5, insert: "HELLO" },
    });
    expect(client.editorView.state.sliceDoc()).toBe(
      "HELLO world\nsecond\nthird\n",
    );

    diskText = "hello world\nsecond\nthird\nExternal line\n";
    diskModified = "2026-01-01T00:00:05.000";

    // Same-page reload (loadingDifferentPath stays false: previousPath ===
    // newPath, both "index.md").
    await cm.loadPage({ path: "index.md" }, false);

    // Must not no-op: if lastKnownDiskText was clobbered to the new disk
    // text before this merge runs, base === disk and the diff -- and thus
    // this assertion -- would be empty regardless of what changed on disk.
    expect(client.editorView.state.sliceDoc()).toContain("External line");
    expect(client.editorView.state.sliceDoc()).toContain("HELLO world");
  });
});

describe("ContentManager.reloadPageContent stale-navigation guard (regression)", () => {
  test("bails out if the current page changed while the read was in flight", async () => {
    let resolveReadPage!: (doc: ReadPageResult) => void;
    const pending = new Promise<ReadPageResult>((resolve) => {
      resolveReadPage = resolve;
    });
    const client = makeClientStub({
      initialDoc: "page A content\n",
      readPage: () => pending,
    });
    client.currentPathValue = "pageA.md";
    const cm = new ContentManager(client as unknown as Client);

    const reloadPromise = cm.reloadPageContent();

    client.currentPathValue = "pageB.md";
    client.editorView.setState(EditorState.create({ doc: "page B content\n" }));

    resolveReadPage({
      text: "page A content\nEXTERNAL EDIT\n",
      meta: pageMeta("2026-01-01T00:00:00.000"),
    });
    await reloadPromise;

    expect(client.editorView.state.sliceDoc()).toBe("page B content\n");
  });

  test("applies normally when the page hasn't changed during the fetch", async () => {
    // initialDoc "" matches ContentManager's default lastKnownDiskText, so
    // the merge is a clean append -- this test only guards against the
    // stale-navigation check above being overzealous, not the merge itself
    // (covered by external_merge.test.ts and the loadPage test above).
    const client = makeClientStub({
      initialDoc: "",
      readPage: async () => ({
        text: "hello\nexternal\n",
        meta: pageMeta("2026-01-01T00:00:00.000"),
      }),
    });
    client.currentPathValue = "index.md";
    const cm = new ContentManager(client as unknown as Client);

    await cm.reloadPageContent();

    expect(client.editorView.state.sliceDoc()).toBe("hello\nexternal\n");
  });
});

describe("ContentManager.applyExternalPatches monotonicity guard (regression)", () => {
  test("drops a stale apply when an older in-flight read resolves after a newer one", async () => {
    let resolveOlder!: (r: ReadPageResult) => void;
    let resolveNewer!: (r: ReadPageResult) => void;
    const olderPromise = new Promise<ReadPageResult>((resolve) => {
      resolveOlder = resolve;
    });
    const newerPromise = new Promise<ReadPageResult>((resolve) => {
      resolveNewer = resolve;
    });
    let call = 0;
    const client = makeClientStub({
      initialDoc: "",
      readPage: () => {
        call++;
        if (call === 1) {
          return Promise.resolve({
            text: "base\n",
            meta: pageMeta("2026-01-01T00:00:00.000"),
          });
        }
        return call === 2 ? olderPromise : newerPromise;
      },
    });
    client.currentPathValue = "index.md";
    const cm = new ContentManager(client as unknown as Client);

    await cm.loadPage({ path: "index.md" }, false);
    expect(client.editorView.state.sliceDoc()).toBe("base\n");

    const olderReload = cm.reloadPageContent();
    const newerReload = cm.reloadPageContent();

    resolveNewer({
      text: "base\nAGENT V2\n",
      meta: pageMeta("2026-01-01T00:00:10.000"),
    });
    await newerReload;
    expect(client.editorView.state.sliceDoc()).toBe("base\nAGENT V2\n");

    resolveOlder({
      text: "base\nAGENT V1\n",
      meta: pageMeta("2026-01-01T00:00:05.000"),
    });
    await olderReload;

    expect(client.editorView.state.sliceDoc()).toBe("base\nAGENT V2\n");
  });
});

describe("ContentManager.reloadPageContent editor:pageReloaded notification", () => {
  test("dispatches editor:pageReloaded after applying a real external patch", async () => {
    let diskText = "hello world\n";
    const client = makeClientStub({
      initialDoc: "",
      readPage: async () => ({
        text: diskText,
        meta: pageMeta("2026-01-01T00:00:00.000"),
      }),
    });
    client.currentPathValue = "index.md";
    const cm = new ContentManager(client as unknown as Client);

    await cm.loadPage({ path: "index.md" }, false);
    client.dispatchedEvents.length = 0;

    diskText = "hello world\nExternal line\n";
    await cm.reloadPageContent();

    const reloaded = client.dispatchedEvents.filter(
      (e) => e.name === "editor:pageReloaded",
    );
    expect(reloaded).toEqual([
      { name: "editor:pageReloaded", args: ["index", "index"] },
    ]);
  });

  test("does not dispatch editor:pageReloaded for a stale patch dropped by the monotonicity guard", async () => {
    let resolveOlder!: (r: ReadPageResult) => void;
    let resolveNewer!: (r: ReadPageResult) => void;
    const olderPromise = new Promise<ReadPageResult>((resolve) => {
      resolveOlder = resolve;
    });
    const newerPromise = new Promise<ReadPageResult>((resolve) => {
      resolveNewer = resolve;
    });
    let call = 0;
    const client = makeClientStub({
      initialDoc: "",
      readPage: () => {
        call++;
        if (call === 1) {
          return Promise.resolve({
            text: "base\n",
            meta: pageMeta("2026-01-01T00:00:00.000"),
          });
        }
        return call === 2 ? olderPromise : newerPromise;
      },
    });
    client.currentPathValue = "index.md";
    const cm = new ContentManager(client as unknown as Client);
    await cm.loadPage({ path: "index.md" }, false);

    const olderReload = cm.reloadPageContent();
    const newerReload = cm.reloadPageContent();

    resolveNewer({
      text: "base\nV2\n",
      meta: pageMeta("2026-01-01T00:00:10.000"),
    });
    await newerReload;
    client.dispatchedEvents.length = 0;

    // Resolves after the newer one, with older content -- dropped by the
    // monotonicity guard in applyExternalPatches. Nothing changed in the
    // editor, so no notification should fire either.
    resolveOlder({
      text: "base\nV1\n",
      meta: pageMeta("2026-01-01T00:00:05.000"),
    });
    await olderReload;

    expect(
      client.dispatchedEvents.some((e) => e.name === "editor:pageReloaded"),
    ).toBe(false);
  });

  test("refreshes viewState.current.meta and body page-decoration classes from the object index", async () => {
    // Frontmatter (and thus the indexed page decoration) only appears after
    // the external edit below -- this is what the initial loadPage sees vs.
    // what the live path must pick up without requiring re-navigation.
    let diskText = "hello world\n";
    const metaBeforeEdit = pageMeta("2026-01-01T00:00:00.000");
    const metaAfterEdit = {
      ...pageMeta("2026-01-01T00:00:05.000"),
      pageDecoration: { cssClasses: ["journal-page"] },
    } as PageMeta;
    let enrichedMeta = metaBeforeEdit;
    const client = makeClientStub({
      initialDoc: "",
      readPage: async () => ({
        text: diskText,
        meta: pageMeta("2026-01-01T00:00:00.000"),
      }),
      hasFullIndexCompleted: async () => true,
      getObjectByRef: async () => enrichedMeta,
    });
    client.currentPathValue = "index.md";
    const cm = new ContentManager(client as unknown as Client);

    await cm.loadPage({ path: "index.md" }, false);
    expect(client.viewState.current?.meta).toEqual(metaBeforeEdit);

    diskText = "hello world\nExternal line\n";
    enrichedMeta = metaAfterEdit;
    await cm.reloadPageContent();

    expect(client.viewState.current?.meta).toEqual(metaAfterEdit);
    expect(
      (globalThis as unknown as { document: { body: { className: string } } })
        .document.body.className,
    ).toBe("journal-page");
  });
});

// The base only moves forward when a write's *response* arrives. A read that
// resolves before it sees content newer than the base it gets diffed against,
// and the merge re-inserts the difference into a document that already has it.
describe("ContentManager merge base vs. in-flight writes (regression: text duplicates while typing)", () => {
  // Lets the debounced save() timeout fire and promise chains settle.
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function typeInto(
    client: ReturnType<typeof makeClientStub>,
    appended: string,
  ) {
    client.editorView.dispatch({
      changes: { from: client.editorView.state.doc.length, insert: appended },
    });
    client.viewState.unsavedChanges = true;
  }

  test("a fetch that returns content from a save still in flight does not duplicate it", async () => {
    let resolveRead!: (r: ReadPageResult) => void;
    let resolveWrite!: (meta: PageMeta) => void;
    let readCall = 0;
    const client = makeClientStub({
      initialDoc: "",
      readPage: () => {
        readCall++;
        if (readCall === 1) {
          return Promise.resolve({
            text: "one\n",
            meta: pageMeta("2026-01-01T00:00:00.000"),
          });
        }
        return new Promise<ReadPageResult>((resolve) => {
          resolveRead = resolve;
        });
      },
      writePage: () =>
        new Promise<PageMeta>((resolve) => {
          resolveWrite = resolve;
        }),
    });
    client.currentPathValue = "index.md";
    const cm = new ContentManager(client as unknown as Client);

    await cm.loadPage({ path: "index.md" }, false);
    typeInto(client, "two");

    // A foreign change is reported, so a fetch starts. No write in flight yet.
    const reload = cm.reloadPageContent();

    // Only now does the autosave fire, and the user keeps typing after it.
    void cm.save(true);
    await flush();
    typeInto(client, "three");

    // The fetch returns what that save is putting on disk...
    resolveRead({
      text: "one\ntwo",
      meta: pageMeta("2026-01-01T00:00:05.000"),
    });
    await flush();
    // ...and only then does the write's response carry the base forward.
    resolveWrite(pageMeta("2026-01-01T00:00:05.000"));
    await reload;

    expect(client.editorView.state.sliceDoc()).toBe("one\ntwothree");
  });

  test("two saves acknowledged out of order leave the base on the newer one", async () => {
    // save() does not wait for the previous write, and nothing orders the two
    // responses.
    const resolvers: ((meta: PageMeta) => void)[] = [];
    let diskText = "one\n";
    let diskModified = "2026-01-01T00:00:00.000";
    const client = makeClientStub({
      initialDoc: "",
      readPage: async () => ({ text: diskText, meta: pageMeta(diskModified) }),
      writePage: () =>
        new Promise<PageMeta>((resolve) => {
          resolvers.push(resolve);
        }),
    });
    client.currentPathValue = "index.md";
    const cm = new ContentManager(client as unknown as Client);

    await cm.loadPage({ path: "index.md" }, false);

    typeInto(client, "two");
    void cm.save(true);
    await flush();
    typeInto(client, "three");
    void cm.save(true);
    await flush();
    expect(resolvers).toHaveLength(2);

    // The later write is acknowledged first; the earlier one lands after.
    resolvers[1](pageMeta("2026-01-01T00:00:09.000"));
    await flush();
    resolvers[0](pageMeta("2026-01-01T00:00:05.000"));
    await flush();

    // Keeps the document ahead of disk, so the merge below is a real one
    // rather than a same-text no-op.
    typeInto(client, "four");

    // With the base dragged back to the earlier write, this re-inserts "three".
    diskText = "one\ntwothree";
    diskModified = "2026-01-01T00:00:09.000";
    await cm.reloadPageContent();

    expect(client.editorView.state.sliceDoc()).toBe("one\ntwothreefour");
  });
});

describe("ContentManager conflict-marker documents (regression)", () => {
  const markerDoc = [
    "Line1",
    "<<<<<<< SB sha256:aaaaaaaa",
    "Line2 changed by Remote",
    "||||||| SB BASE sha256:bbbbbbbb",
    "Line2 original",
    "=======",
    "Line2 changed by Tab1",
    ">>>>>>> SB sha256:cccccccc",
    "Line3",
    "",
  ].join("\n");

  test("a marker document lands verbatim on an editor holding its own side of the conflict", async () => {
    let diskText = "Line1\nLine2 original\nLine3\n";
    let diskModified = "2026-01-01T00:00:00.000";
    const client = makeClientStub({
      initialDoc: "",
      readPage: async () => ({ text: diskText, meta: pageMeta(diskModified) }),
    });
    client.currentPathValue = "index.md";
    const cm = new ContentManager(client as unknown as Client);

    await cm.loadPage({ path: "index.md" }, false);

    client.editorView.dispatch({
      changes: {
        from: "Line1\nLine2 ".length,
        to: "Line1\nLine2 original".length,
        insert: "changed by Tab1",
      },
    });
    expect(client.editorView.state.sliceDoc()).toBe(
      "Line1\nLine2 changed by Tab1\nLine3\n",
    );

    diskText = markerDoc;
    diskModified = "2026-01-01T00:00:05.000";
    await cm.reloadPageContent("sync");

    expect(client.editorView.state.sliceDoc()).toBe(markerDoc);
  });
});

// The autosave clobber: an external update that couldn't be merged was
// withheld, leaving the buffer a *sibling* of what storage holds rather than
// a descendant. Writing it plainly makes the sync engine push it as a clean
// fast-forward, and the withheld revision is gone with no conflict raised.
describe("ContentManager save after a withheld external update", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const BASE = "Line1\nLine2 original\nLine3\n";
  const REMOTE = "Line1\nLine2 changed by Remote\nLine3\n";
  const LOCAL = "Line1\nLine2 changed by Tab1\nLine3\n";

  function rewriteLine2(
    client: ReturnType<typeof makeClientStub>,
    text: string,
  ) {
    client.editorView.dispatch({
      changes: {
        from: "Line1\n".length,
        to: client.editorView.state.doc.line(2).to,
        insert: text,
      },
    });
    client.viewState.unsavedChanges = true;
  }

  async function setUpCollision() {
    let diskText = BASE;
    let diskModified = "2026-01-01T00:00:00.000";
    const written: string[] = [];
    const client = makeClientStub({
      initialDoc: "",
      readPage: async () => ({ text: diskText, meta: pageMeta(diskModified) }),
      writePage: async (_name, text) => {
        written.push(text);
        diskText = text;
        diskModified = "2026-01-01T00:00:10.000";
        return pageMeta(diskModified);
      },
    });
    client.currentPathValue = "index.md";
    const cm = new ContentManager(client as unknown as Client);
    await cm.loadPage({ path: "index.md" }, false);

    rewriteLine2(client, "Line2 changed by Tab1");
    expect(client.editorView.state.sliceDoc()).toBe(LOCAL);

    const setDisk = (text: string, modified: string) => {
      diskText = text;
      diskModified = modified;
    };
    setDisk(REMOTE, "2026-01-01T00:00:05.000");
    await cm.reloadPageContent();
    // Withheld, exactly as external_merge decided: the buffer keeps its own
    // line rather than being spliced with the remote's.
    expect(client.editorView.state.sliceDoc()).toBe(LOCAL);

    return { client, cm, written, setDisk };
  }

  test("declares the base the buffer descends from before writing over the pulled revision", async () => {
    const { client, cm, written } = await setUpCollision();

    await cm.save(true);
    await flush();

    // Not the pulled revision, and not the buffer either: the last revision
    // both sides shared, which is what makes the write reconcilable.
    expect(client.declaredBases).toEqual([
      { path: "index.md", baseText: BASE },
    ]);
    expect(written).toEqual([LOCAL]);
  });

  test("declares nothing for an ordinary save with no update outstanding", async () => {
    let diskText = "hello\n";
    const written: string[] = [];
    const client = makeClientStub({
      initialDoc: "",
      readPage: async () => ({
        text: diskText,
        meta: pageMeta("2026-01-01T00:00:00.000"),
      }),
      writePage: async (_name, text) => {
        written.push(text);
        diskText = text;
        return pageMeta("2026-01-01T00:00:10.000");
      },
    });
    client.currentPathValue = "index.md";
    const cm = new ContentManager(client as unknown as Client);
    await cm.loadPage({ path: "index.md" }, false);

    client.editorView.dispatch({
      changes: { from: client.editorView.state.doc.length, insert: "more" },
    });
    client.viewState.unsavedChanges = true;
    await cm.save(true);
    await flush();

    expect(client.declaredBases).toEqual([]);
    expect(written).toEqual(["hello\nmore"]);
  });

  test("applies the withheld update instead once the collision is gone", async () => {
    const { client, cm, written } = await setUpCollision();

    // The user backs their edit out before the autosave fires, so the two
    // sides no longer contest the line.
    rewriteLine2(client, "Line2 original");
    expect(client.editorView.state.sliceDoc()).toBe(BASE);

    await cm.save(true);
    await flush();

    // Retried at save time and merged in, so no round trip through the
    // server is needed and the editor is already current.
    expect(client.editorView.state.sliceDoc()).toBe(REMOTE);
    expect(client.declaredBases).toEqual([]);
    expect(written).toEqual([REMOTE]);
  });

  test("keeps merging a later external change against the base the buffer knows", async () => {
    const { client, cm, setDisk } = await setUpCollision();

    // A genuine second revision: the remote's contested rewrite plus an
    // appended line. The base must still be the one the buffer descends from
    // -- diffing against the withheld revision instead would treat the
    // remote's rewritten line as common ground the buffer never had, and the
    // collision would go unnoticed.
    setDisk(`${REMOTE}Line4 remote\n`, "2026-01-01T00:00:07.000");
    await cm.reloadPageContent();
    expect(client.editorView.state.sliceDoc()).toBe(LOCAL);

    await cm.save(true);
    await flush();
    expect(client.declaredBases).toEqual([
      { path: "index.md", baseText: BASE },
    ]);
  });

  // clearTimeout can't cancel a save callback that already suspended on the
  // declare, and leaveCurrentPage's own save(true) reschedules rather than
  // waiting for it -- so the stale callback resumes after the new page has
  // been loaded.
  test("drops the write when the page changes while the declare is in flight", async () => {
    const { client, cm, written } = await setUpCollision();

    let releaseDeclare!: () => void;
    client.blockDeclareOn = new Promise<void>((resolve) => {
      releaseDeclare = resolve;
    });

    const saving = cm.save(true);
    await flush();
    expect(client.declaredBases).toHaveLength(1);

    client.currentPathValue = "other.md";
    client.editorView.setState(EditorState.create({ doc: "other page\n" }));

    releaseDeclare();
    await saving;
    await flush();

    expect(written).toEqual([]);
  });
});

describe("ContentManager.save error handling", () => {
  function setUpFailingSave(writeError: unknown) {
    const flashes: { message: string; type?: string }[] = [];
    const client = makeClientStub({
      initialDoc: "hello",
      readPage: async () => ({
        text: "hello",
        meta: pageMeta("2026-01-01T00:00:00.000"),
      }),
      writePage: async () => {
        throw writeError;
      },
      flashNotification: (message, type) => flashes.push({ message, type }),
    });
    client.currentPathValue = "index.md";
    client.viewState.unsavedChanges = true;
    const cm = new ContentManager(client as unknown as Client);
    return { cm, flashes };
  }

  test("a PermissionDeniedError flashes a read-only notice and does not schedule a retry", async () => {
    const { cm, flashes } = setUpFailingSave(new PermissionDeniedError());
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    await expect(cm.save(true)).rejects.toThrow(PermissionDeniedError);

    expect(flashes).toEqual([
      { message: "You have read-only access to this space", type: "error" },
    ]);
    expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 10000)).toBe(
      false,
    );

    setTimeoutSpy.mockRestore();
  });

  test("an ordinary write failure flashes the retry message and schedules a 10s retry", async () => {
    const { cm, flashes } = setUpFailingSave(new Error("network blip"));
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    await expect(cm.save(true)).rejects.toThrow("network blip");

    expect(flashes).toEqual([
      {
        message: "Could not save page, retrying again in 10 seconds",
        type: "error",
      },
    ]);
    expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 10000)).toBe(
      true,
    );

    setTimeoutSpy.mockRestore();
    // The catch scheduled a real 10s retry against this ContentManager;
    // clear it so it doesn't fire (and call save() again) after the test ends.
    clearTimeout(cm.saveTimeout);
  });
});
