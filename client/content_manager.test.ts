import { describe, expect, test, vi } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import type { Client } from "./client.ts";

// content_manager.ts imports codemirror/editor_state.ts for createEditorState
// and externalUpdate. That module (transitively, via lua_widget.ts ->
// widget_sandbox_iframe.ts) calls document.createElement at module scope, so
// it can't load under this project's Node-environment vitest config (no
// jsdom/happy-dom, and adding one is out of scope). Replace it with a
// minimal stand-in exposing the same two names -- content_manager.ts itself,
// the actual subject of these tests, is imported for real, unmocked.
vi.mock("./codemirror/editor_state.ts", async () => {
  const { Annotation, EditorState: RealEditorState } = await import(
    "@codemirror/state"
  );
  return {
    createEditorState: (
      _client: unknown,
      _pageName: string,
      text: string,
      _readOnly: boolean,
    ) => RealEditorState.create({ doc: text }),
    externalUpdate: Annotation.define<boolean>(),
  };
});

const { ContentManager } = await import("./content_manager.ts");

// content_manager.ts's enriched-meta refresh (loadPage and, after this
// change, reloadPageContent) reads/writes document.body directly for
// frontmatter-derived page-decoration classes. No jsdom in this Node vitest
// config (see the module mock above), so provide the minimal shape used.
(globalThis as unknown as { document: { body: unknown } }).document = {
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
  const dispatched: TransactionSpec[] = [];
  return {
    get state() {
      return state;
    },
    setState(newState: EditorState) {
      state = newState;
    },
    dispatch(spec: TransactionSpec) {
      dispatched.push(spec);
      state = state.update(spec).state;
    },
    dispatched,
  };
}

type ReadPageResult = { text: string; meta: PageMeta };

function makeClientStub(opts: {
  initialDoc: string;
  readPage: () => Promise<ReadPageResult>;
  writePage?: (name: string, text: string) => Promise<PageMeta>;
  hasFullIndexCompleted?: () => Promise<boolean>;
  getObjectByRef?: () => Promise<PageMeta | undefined>;
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

  const client = {
    editorView,
    viewState,
    set currentPathValue(v: string) {
      currentPathValue = v;
    },
    ui: {
      viewState,
      flashNotification: () => {},
      viewDispatch: (action: {
        type: string;
        path?: string;
        meta?: PageMeta;
      }) => {
        viewDispatched.push(action);
        if (action.type === "page-loaded" && action.path) {
          viewState.current = { path: action.path, meta: action.meta };
        }
        if (action.type === "update-current-page-meta" && viewState.current) {
          viewState.current = { ...viewState.current, meta: action.meta };
        }
      },
    },
    space: {
      readPage: opts.readPage,
      writePage:
        opts.writePage ?? (async () => pageMeta("2026-01-01T00:00:00.000")),
      unwatchFile: () => {},
      watchFile: () => {},
    },
    objectIndex: {
      hasFullIndexCompleted: opts.hasFullIndexCompleted ?? (async () => false),
      getObjectByRef: opts.getObjectByRef ?? (async () => undefined),
    },
    widgetCache: { clearPrewarm: () => {} },
    pageMetaAugmenter: { setAugmentation: async () => {} },
    eventHook: {
      dispatchEvent: async (name: string, ...args: unknown[]) => {
        dispatchedEvents.push({ name, args });
        return [];
      },
    },
    isReadOnlyMode: () => false,
    dispatchAppEvent: async () => [],
    currentPath: () => currentPathValue,
    currentName: () => currentPathValue.replace(/\.md$/, ""),
    dispatchedEvents,
    viewDispatched,
  };
  return client;
}

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
    let diskText = "hello world\n";
    let diskModified = "2026-01-01T00:00:00.000";
    const client = makeClientStub({
      initialDoc: "",
      readPage: async () => ({ text: diskText, meta: pageMeta(diskModified) }),
    });
    client.currentPathValue = "index.md";
    const cm = new ContentManager(client as unknown as Client);

    // Fresh load establishes the base.
    await cm.loadPage({ path: "index.md" }, false);
    expect(client.editorView.state.sliceDoc()).toBe("hello world\n");

    // An unsaved local edit sits in the editor -- stale relative to the disk
    // change below, exactly the situation "Editor: Reload" or the
    // first-sync-complete auto-reload can hit.
    client.editorView.dispatch({
      changes: { from: client.editorView.state.doc.length, insert: "LOCAL" },
    });
    expect(client.editorView.state.sliceDoc()).toBe("hello world\nLOCAL");

    // Disk changes externally while that edit is still unsaved.
    diskText = "hello world\nExternal line\n";
    diskModified = "2026-01-01T00:00:05.000";

    // Same-page reload (loadingDifferentPath stays false: previousPath ===
    // newPath, both "index.md").
    await cm.loadPage({ path: "index.md" }, false);

    // Must not no-op: if lastKnownDiskText was clobbered to the new disk
    // text before this merge runs, base === disk and the diff -- and thus
    // this assertion -- would be empty regardless of what changed on disk.
    expect(client.editorView.state.sliceDoc()).toContain("External line");
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

    // User navigates to a different page while the fetch above is still in
    // flight.
    client.currentPathValue = "pageB.md";
    client.editorView.setState(EditorState.create({ doc: "page B content\n" }));

    // The stale fetch for page A finally resolves, with page-A-derived
    // external content.
    resolveReadPage({
      text: "page A content\nEXTERNAL EDIT\n",
      meta: pageMeta("2026-01-01T00:00:00.000"),
    });
    await reloadPromise;

    // Page B's content must be untouched by page A's stale patch.
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

    // Seed the base (lastKnownDiskText/lastKnownDiskModified) via a fresh load.
    await cm.loadPage({ path: "index.md" }, false);
    expect(client.editorView.state.sliceDoc()).toBe("base\n");

    // Two reloads for the same page, in flight concurrently (e.g. a direct
    // reloadEditor racing an SSE-triggered reloadPageContent).
    const olderReload = cm.reloadPageContent();
    const newerReload = cm.reloadPageContent();

    // The one reading the newer disk state resolves first.
    resolveNewer({
      text: "base\nAGENT V2\n",
      meta: pageMeta("2026-01-01T00:00:10.000"),
    });
    await newerReload;
    expect(client.editorView.state.sliceDoc()).toBe("base\nAGENT V2\n");

    // The stale (older) read resolves after -- must not revert the editor.
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

    // Without navigating away and back, viewState.current.meta must already
    // reflect the post-edit frontmatter, and the body decoration classes
    // derived from it.
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
