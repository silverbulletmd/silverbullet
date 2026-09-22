import { redoDepth, undo, undoDepth } from "@codemirror/commands";
import { language, syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  runScopeHandlers,
  type ViewUpdate,
} from "@codemirror/view";
import { expect, test, vi } from "vitest";
import type { Client } from "../client.ts";
import { registerEditorCommands } from "../editor_commands.ts";
import { loadLanguageFor } from "../languages.ts";
import type { CommandHook } from "../plugos/hooks/command.ts";
import type { Command } from "../types/command.ts";
import type { EditorMode } from "./editor_state.ts";

vi.hoisted(() => {
  vi.stubGlobal("document", {
    documentElement: { style: {} },
    addEventListener: () => {},
  });
  vi.stubGlobal("navigator", { platform: "Linux", userAgent: "", vendor: "" });
});
vi.mock("../components/widget_sandbox_iframe.ts", () => ({
  prepareSandboxIFrame: () => {
    throw new Error("unexpected iframe creation");
  },
  getSandboxIFrame: () => {
    throw new Error("unexpected iframe creation");
  },
}));

const {
  createEditorState,
  createInactiveEditorState,
  buildSharedEditorExtensions,
  buildPageExtensions,
  buildTextDocumentExtensions,
  createCommandKeyBindings,
  buildEditorUpdateListener,
  createEditorUpdateHandler,
  externalUpdate,
} = await import("./editor_state.ts");
const inlineContent = await import("./inline_content.ts");
const pageLint = await import("./lint.ts");
const pageWidgets = await import("./top_bottom_panels.ts");

function clientStub(): Client {
  return {
    ui: {
      viewState: { uiOptions: { markdownSyntaxRendering: true } },
      viewDispatch: vi.fn(),
    },
    bootConfig: { readOnly: false },
    config: { get: (_key: string, fallback: unknown) => fallback },
    clientSystem: {
      commandHook: { buildAllCommands: () => new Map() },
      slashCommandHook: { slashCommandCompleter: () => null },
      scriptsLoaded: false,
    },
    contentManager: { isDocumentEditor: () => false },
    editorComplete: () => null,
    currentPageMeta: () => undefined,
    isReadOnlyMode: () => false,
    focus: vi.fn(),
    reportError: vi.fn(),
  } as unknown as Client;
}

test("page mode retains Markdown parsing and wrapping", () => {
  const client = clientStub();
  const state = createEditorState(
    client,
    { kind: "page", pageName: "Example" },
    "# Heading",
    false,
  );
  expect(syntaxTree(state).topNode.name).toBe("Document");
  expect(syntaxTree(state).toString()).toContain("ATXHeading1");
  expect(buildPageExtensions(client, "Example")).toContain(
    EditorView.lineWrapping,
  );
});

test("text mode installs Rust without accessing page completion or widgets", async () => {
  const client = clientStub();
  const inlineSpy = vi.spyOn(inlineContent, "inlineContentPlugin");
  const lintSpy = vi.spyOn(pageLint, "plugLinter");
  const widgetSpy = vi.spyOn(pageWidgets, "postScriptPrefacePlugin");
  const domHandlersSpy = vi.spyOn(EditorView, "domEventHandlers");
  Object.defineProperty(client, "editorComplete", {
    get: () => {
      throw new Error("page completion installed");
    },
  });
  Object.defineProperty(client, "currentPageMeta", {
    get: () => {
      throw new Error("page widgets installed");
    },
  });
  const mode: EditorMode = {
    kind: "text-document",
    path: "sample.rs",
    language: await loadLanguageFor("rs"),
  };
  const state = createEditorState(
    client,
    mode,
    "fn main() {}",
    false,
    EditorSelection.single(3),
  );
  expect(state.facet(language)).toBe(mode.language);
  expect(syntaxTree(state).toString()).toContain("keyword");
  expect(syntaxTree(state).toString()).not.toContain("Paragraph");
  expect(syntaxTree(state).length).toBe(12);
  expect(state.facet(EditorState.readOnly)).toBe(false);
  expect(state.selection.main.head).toBe(3);
  expect(inlineSpy).not.toHaveBeenCalled();
  expect(lintSpy).not.toHaveBeenCalled();
  expect(widgetSpy).not.toHaveBeenCalled();
  expect(
    domHandlersSpy.mock.calls.some(
      ([handlers]) => handlers.touchmove || handlers.touchend,
    ),
  ).toBe(false);
  expect(state.facet(EditorView.contentAttributes)).toContainEqual({
    spellcheck: "false",
    autocorrect: "off",
    autocapitalize: "off",
  });
  expect(buildSharedEditorExtensions(client, mode, false)).not.toContain(
    EditorView.lineWrapping,
  );
  expect(buildTextDocumentExtensions(mode.language)).not.toContain(
    EditorView.lineWrapping,
  );
  vi.restoreAllMocks();
});

test.each([
  "document",
  "forced",
  "space",
])("text mode honors %s read-only", (source) => {
  const client = clientStub();
  client.ui.viewState.uiOptions.forcedROMode = source === "forced";
  client.bootConfig.readOnly = source === "space";
  const state = createEditorState(
    client,
    { kind: "text-document", path: "example.txt", language: null },
    "plain text",
    source === "document",
  );
  expect(state.readOnly).toBe(true);
  expect(state.facet(EditorView.editable)).toBe(false);
});

function dispatchAnyKeyBinding(
  state: EditorState,
  key: string,
): { handled: boolean; state: EditorState } {
  let currentState = state;
  const target = {
    get state() {
      return currentState;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0]) {
      currentState = currentState.update(spec).state;
    },
  } as unknown as EditorView;
  const event = { key } as KeyboardEvent;
  const handled = state
    .facet(keymap)
    .flat()
    .some((binding) => binding.any?.(target, event) === true);
  return { handled, state: currentState };
}

test("text quote key handling stays literal while page mode retains smart quotes", () => {
  const client = clientStub();
  const textState = createEditorState(
    client,
    {
      kind: "text-document",
      path: "example.txt",
      language: null,
    },
    "word ",
    false,
    EditorSelection.single(5),
  );
  const bindings = textState.facet(keymap).flat();
  expect(bindings.some((binding) => binding.key === "Enter")).toBe(true);
  expect(bindings.some((binding) => binding.key === "Tab")).toBe(true);
  const textResult = dispatchAnyKeyBinding(textState, '"');
  expect(textResult.handled).toBe(false);
  expect(textResult.state.doc.toString()).toBe("word ");

  const pageState = createEditorState(
    client,
    {
      kind: "page",
      pageName: "Example",
    },
    "word ",
    false,
    EditorSelection.single(5),
  );
  const pageResult = dispatchAnyKeyBinding(pageState, '"');
  expect(pageResult.handled).toBe(true);
  expect(pageResult.state.doc.toString()).toBe("word “");
});

test.each([
  "MediaViewer",
  "SpecialEditor",
])("inactive %s state runs global and matching editor commands only", async (editorName) => {
  const client = clientStub();
  const ran: string[] = [];
  client.contentManager.documentEditor = {
    name: editorName,
  } as typeof client.contentManager.documentEditor;
  const definitions: Array<[string, string | undefined, string]> = [
    ["global", undefined, "Ctrl-Alt-g"],
    ["matching", editorName, "Ctrl-Alt-m"],
    ["text", "TextEditor", "Ctrl-Alt-t"],
  ];
  client.clientSystem.commandHook.buildAllCommands = () =>
    new Map<string, Command>(
      definitions.map(([name, requireEditor, key]) => [
        name,
        {
          name,
          requireEditor,
          key,
          run: async () => {
            ran.push(name);
          },
        } as Command,
      ]),
    );
  let state = createInactiveEditorState(
    client,
    EditorState.create({ doc: "hidden document" }),
  );
  const view = {
    get state() {
      return state;
    },
    dispatch: (transaction: import("@codemirror/state").Transaction) => {
      state = transaction.state;
    },
  } as unknown as EditorView;
  const keyEvent = (key: string) =>
    ({
      key,
      keyCode: key.toUpperCase().charCodeAt(0),
      ctrlKey: true,
      altKey: true,
      metaKey: false,
      shiftKey: false,
      preventDefault() {},
      stopPropagation() {},
    }) as KeyboardEvent;

  expect(runScopeHandlers(view, keyEvent("g"), "editor")).toBe(true);
  expect(runScopeHandlers(view, keyEvent("m"), "editor")).toBe(true);
  expect(runScopeHandlers(view, keyEvent("t"), "editor")).toBe(false);
  await Promise.resolve();
  expect(ran).toEqual(["global", "matching"]);
  expect(state.readOnly).toBe(true);
  expect(state.facet(language)).toBeNull();
  expect(undoDepth(state)).toBe(0);

  client.clientSystem.commandHook.buildAllCommands = () =>
    new Map([
      [
        "late",
        {
          name: "late",
          key: "Ctrl-Alt-l",
          run: async () => {
            ran.push("late");
          },
        } as Command,
      ],
    ]);
  state = state.update({
    effects: client.commandKeyHandlerCompartment!.reconfigure(
      createCommandKeyBindings(client),
    ),
  }).state;
  expect(runScopeHandlers(view, keyEvent("l"), "editor")).toBe(true);
  await Promise.resolve();
  expect(ran).toEqual(["global", "matching", "late"]);
});

test.each([
  ["CRLF", "first\r\nsecond\r\n"],
  ["LF", "first\nsecond\n"],
])("%s text state rebuilds into an inactive command state", async (_name, text) => {
  const client = clientStub();
  const ran = vi.fn();
  client.contentManager.documentEditor = {
    name: "MediaViewer",
  } as typeof client.contentManager.documentEditor;
  client.clientSystem.commandHook.buildAllCommands = () =>
    new Map([
      [
        "global",
        {
          name: "global",
          key: "Ctrl-Alt-g",
          run: async () => ran(),
        } as Command,
      ],
    ]);
  const source = createEditorState(
    client,
    { kind: "text-document", path: "sample.txt", language: null },
    text,
    false,
  );
  const selected = source.update({
    selection: EditorSelection.single(source.doc.length),
  }).state;

  const inactive = createInactiveEditorState(client, selected);
  expect(inactive.doc.eq(selected.doc)).toBe(true);
  expect(inactive.selection.main.head).toBe(selected.selection.main.head);
  expect(inactive.sliceDoc()).toBe(text);

  const view = { state: inactive } as unknown as EditorView;
  expect(
    runScopeHandlers(
      view,
      {
        key: "g",
        keyCode: 71,
        ctrlKey: true,
        altKey: true,
        metaKey: false,
        shiftKey: false,
        preventDefault() {},
        stopPropagation() {},
      } as KeyboardEvent,
      "editor",
    ),
  ).toBe(true);
  await Promise.resolve();
  expect(ran).toHaveBeenCalledOnce();
});

test("change callbacks retain the plugin update phase", () => {
  const state = EditorState.create({
    extensions: buildEditorUpdateListener(clientStub(), {
      kind: "page",
      pageName: "Example",
    }),
  });
  expect(state.facet(EditorView.updateListener)).toHaveLength(0);
});

test.each([
  "undo",
  "redo",
])("text %s shortcuts work with page commands filtered out", (operation) => {
  const client = clientStub();
  const commands = new Map<string, Command>();
  registerEditorCommands(client, {
    registerCommand: (command: Command) => commands.set(command.name, command),
  } as unknown as CommandHook);
  client.clientSystem.commandHook.buildAllCommands = () => commands;
  client.contentManager.documentEditor = {
    name: "TextEditor",
  } as typeof client.contentManager.documentEditor;
  let state = createEditorState(
    client,
    { kind: "text-document", path: "example.txt", language: null },
    "hello",
    false,
  );
  const view = {
    get state() {
      return state;
    },
    dispatch: (transaction: import("@codemirror/state").Transaction) => {
      state = transaction.state;
    },
  } as unknown as EditorView;
  client.editorView = view;
  state = state.update({ changes: { from: 5, insert: "!" } }).state;
  expect(undoDepth(state)).toBe(1);
  if (operation === "redo") {
    expect(undo(view)).toBe(true);
    expect(redoDepth(state)).toBe(1);
  }
  const event = {
    key: operation === "undo" ? "z" : "y",
    keyCode: operation === "undo" ? 90 : 89,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault() {},
    stopPropagation() {},
  } as KeyboardEvent;
  expect(runScopeHandlers(view, event, "editor")).toBe(true);
  expect(state.sliceDoc()).toBe(operation === "undo" ? "hello" : "hello!");
  expect(operation === "undo" ? redoDepth(state) : undoDepth(state)).toBe(1);
});

test.each([
  "page",
  "text-document",
] as const)("%s edits save and dispatch only their own events", (kind) => {
  const client = clientStub();
  client.save = vi.fn(async () => {});
  client.dispatchAppEvent = vi.fn(async () => []);
  client.contentManager.debouncedUpdateEvent = Object.assign(vi.fn(), {
    flush: vi.fn(),
  });
  const mode: EditorMode =
    kind === "page"
      ? { kind, pageName: "Example" }
      : { kind, path: "example.txt", language: null };
  const state = EditorState.create({
    doc: "hello",
  });
  const listener = createEditorUpdateHandler(client, mode);
  const transaction = state.update({ changes: { from: 5, insert: "!" } });
  listener({
    docChanged: true,
    transactions: [transaction],
    changes: transaction.changes,
    view: { composing: false },
  } as unknown as ViewUpdate);
  expect(client.ui.viewDispatch).toHaveBeenCalledWith({
    type: kind === "page" ? "page-changed" : "document-editor-changed",
  });
  expect(client.save).toHaveBeenCalledOnce();
  if (kind === "page") {
    expect(client.dispatchAppEvent).toHaveBeenCalledWith(
      "editor:pageModified",
      {
        changes: [
          {
            inserted: "!",
            oldRange: { from: 5, to: 5 },
            newRange: { from: 5, to: 6 },
          },
        ],
      },
    );
    expect(client.contentManager.debouncedUpdateEvent).toHaveBeenCalledOnce();
  } else {
    expect(client.dispatchAppEvent).not.toHaveBeenCalled();
    expect(client.contentManager.debouncedUpdateEvent).not.toHaveBeenCalled();
  }
});

test("text composition defers saving and ignores external updates", () => {
  const client = clientStub();
  client.save = vi.fn(async () => {});
  const state = EditorState.create({
    doc: "hello",
  });
  const listener = createEditorUpdateHandler(client, {
    kind: "text-document",
    path: "example.txt",
    language: null,
  });
  const transaction = state.update({ changes: { from: 5, insert: "!" } });
  listener({
    docChanged: true,
    transactions: [transaction],
    changes: transaction.changes,
    view: { composing: true },
  } as unknown as ViewUpdate);
  expect(client.save).not.toHaveBeenCalled();
  expect(client.ui.viewDispatch).toHaveBeenCalledWith({
    type: "document-editor-changed",
  });
  listener({
    docChanged: false,
    transactions: [],
    view: { composing: false },
  } as unknown as ViewUpdate);
  expect(client.save).toHaveBeenCalledOnce();
  const external = state.update({
    changes: { from: 5, insert: "remote" },
    annotations: externalUpdate.of(true),
  });
  listener({
    docChanged: true,
    transactions: [external],
    changes: external.changes,
    view: { composing: false },
  } as unknown as ViewUpdate);
  expect(client.save).toHaveBeenCalledOnce();
});
