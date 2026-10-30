// @vitest-environment happy-dom
import { history, isolateHistory } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, test, vi } from "vitest";
import { buildExtendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { dataBlockPreviewPlugin } from "./data_block_preview.ts";
import { type ObjectPreview, ObjectPreviewWidget } from "./object_preview.ts";

vi.mock("../../sandbox/widget_sandbox_iframe.ts", () => ({
  createWidgetSandboxIFrame: vi.fn(),
}));

// Stand-in for LuaWidget that, like the prewarm cache, renders once per cache
// key: a later widget with the same key gets the first one's DOM (and with it
// the ctx the first render closed over)
const created: { cacheKey: string }[] = [];
const destroyed: unknown[] = [];
const prewarmed = new Map<string, Promise<unknown>>();
vi.mock("../widgets/lua_widget.ts", () => ({
  LuaWidget: class {
    cacheKey: string;
    constructor(
      private options: {
        cacheKey: string;
        callback: (...args: any[]) => any;
      },
    ) {
      this.cacheKey = options.cacheKey;
      created.push(this);
    }
    toDOM() {
      const div = document.createElement("div");
      const result: Promise<unknown> =
        prewarmed.get(this.cacheKey) ?? this.options.callback("", "", () => {});
      prewarmed.set(this.cacheKey, result);
      void result.then((node: unknown) => {
        if (node instanceof Node) div.appendChild(node);
      });
      return div;
    }
    destroy() {
      destroyed.push(this);
    }
  },
}));

const PAGE = "Contacts";
const doc = [
  "```#contact",
  "name: Alice",
  "---",
  "name: Bob",
  "```",
  "Outro",
].join("\n");

afterEach(() => {
  document.body.innerHTML = "";
  created.length = 0;
  destroyed.length = 0;
  prewarmed.clear();
});

function harness(localSyscall: (...args: unknown[]) => Promise<unknown>) {
  const contexts: any[] = [];
  const render = (_object: unknown, ctx: unknown) => {
    contexts.push(ctx);
    return document.createElement("div");
  };
  const stub = {
    currentName: () => PAGE,
    currentPageMeta: () => ({}),
    isReadOnlyMode: () => false,
    config: {
      get: (path: string[], fallback: unknown) =>
        path[0] === "tags" && path[2] === "renderDataBlock" ? render : fallback,
    },
    clientSystem: {
      scriptsLoaded: true,
      luaCodeWidgets: new Map(),
      codeWidgetHook: { codeWidgetCallbacks: new Map() },
      localSyscall,
    },
    ui: { viewState: { uiOptions: { markdownSyntaxRendering: false } } },
    systemReady: true,
    fullIndexCompleted: true,
    pageListLoaded: true,
  };
  const mount = (text: string) => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        selection: { anchor: text.length },
        extensions: [
          history(),
          buildExtendedMarkdownLanguage(),
          dataBlockPreviewPlugin(stub as never),
        ],
      }),
    });
  };

  return { contexts, mount, stub, render };
}

test("identical data blocks own separate forms and write to their own positions", async () => {
  const localSyscall = vi.fn(async (..._args: unknown[]) => {});
  const { contexts, mount } = harness(localSyscall);
  const block = "```#contact\nname: Sample\n```";
  const text = `${block}\n\n${block}\nOutro`;
  vi.useFakeTimers();
  const view = mount(text);
  try {
    await vi.runAllTimersAsync();
    expect(contexts).toHaveLength(2);
    expect(
      view.dom.querySelectorAll(".sb-object-preview-item div div"),
    ).toHaveLength(2);
    for (const ctx of contexts.slice()) await ctx.set("name", "Updated");
    const first = text.indexOf("name: Sample");
    const second = text.lastIndexOf("name: Sample");
    expect(
      localSyscall.mock.calls.map((call) => (call[1] as any[])[0].ref),
    ).toEqual([`${PAGE}@${first}`, `${PAGE}@${second}`]);
  } finally {
    view.destroy();
    vi.useRealTimers();
  }
});

test("a remounted form owns fresh callbacks and rejects writes from detached DOM", async () => {
  const localSyscall = vi.fn(async (..._args: unknown[]) => {});
  const { contexts, mount } = harness(localSyscall);
  vi.useFakeTimers();
  const first = mount(doc);
  await vi.runAllTimersAsync();
  first.destroy();
  const shifted = `Two new\nlines\n${doc}`;
  const second = mount(shifted);
  try {
    await vi.runAllTimersAsync();
    expect(contexts).toHaveLength(4);
    await expect(contexts[0].set("name", "Stale")).rejects.toThrow();
    expect(localSyscall).not.toHaveBeenCalled();
    await contexts[3].set("name", "Updated");
    expect(localSyscall).toHaveBeenCalledWith("object.update", [
      expect.objectContaining({
        ref: `${PAGE}@${shifted.indexOf("\nname: Bob")}`,
      }),
      { name: "Updated" },
      { remove: [] },
    ]);
  } finally {
    second.destroy();
    vi.useRealTimers();
  }
});

test("undo from a widget waits for the edit it just committed", async () => {
  let land: (() => void) | undefined;
  let view: EditorView | undefined;
  const localSyscall = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        land = () => {
          const at = view!.state.doc.toString().indexOf("Alice");
          view!.dispatch({
            changes: { from: at, to: at + 5, insert: "Alicia" },
          });
          resolve();
        };
      }),
  );
  const { contexts, mount } = harness(localSyscall);
  vi.useFakeTimers();
  view = mount(doc);
  try {
    await vi.runAllTimersAsync();
    // An unrelated earlier change: the step a too-early undo would revert
    const end = view.state.doc.length;
    view.dispatch({
      changes: { from: end, insert: "!" },
      annotations: isolateHistory.of("full"),
    });

    const committed = contexts[0].set("name", "Alicia");
    await vi.advanceTimersByTimeAsync(0);
    expect(localSyscall).toHaveBeenCalled();
    // Mod-z right after Enter, while the write is still on its way
    view.dom.querySelector(".sb-object-preview")!.dispatchEvent(
      new InputEvent("beforeinput", {
        inputType: "historyUndo",
        bubbles: true,
        cancelable: true,
      }),
    );
    land!();
    await committed;
    await vi.runAllTimersAsync();

    expect(view.state.doc.toString()).toBe(`${doc}!`);
  } finally {
    view.destroy();
    vi.useRealTimers();
  }
});

test("a form marked data-sb-keep survives focus leaving after a commit", async () => {
  const localSyscall = vi.fn(async () => {});
  const { contexts, mount } = harness(localSyscall);
  vi.useFakeTimers();
  const view = mount(doc);
  const outside = document.createElement("input");
  document.body.appendChild(outside);
  try {
    await vi.runAllTimersAsync();
    const form = view.dom.querySelector(".sb-object-preview-item div div")!;
    const field = document.createElement("input");
    form.appendChild(field);
    field.focus();
    // Committed with focus kept: the DOM no longer matches a render
    await contexts[0].set("name", "Alicia");

    // A picker the form opened takes focus
    form.setAttribute("data-sb-keep", "");
    outside.focus();
    // What leaving the form does once focus has settled elsewhere
    view.dispatch({});
    expect(form.isConnected).toBe(true);

    // Done picking: the next update rebuilds it
    form.removeAttribute("data-sb-keep");
    view.dispatch({});
    expect(form.isConnected).toBe(false);
  } finally {
    view.destroy();
    vi.useRealTimers();
  }
});

test("a DOM handed to an equal widget keeps what it shows, and destroy finds it", async () => {
  const { contexts, mount, stub, render } = harness(vi.fn(async () => {}));
  const view = mount("Text");
  const preview: ObjectPreview = {
    host: {
      kind: "data",
      className: "sb-test-preview",
      label: "Test",
      documents: () => undefined,
      target: () => undefined,
    },
    page: PAGE,
    from: 0,
    to: 4,
    source: "name: Alice",
    objects: [
      {
        index: 0,
        object: { name: "Alice" },
        context: { values: { name: "Alice" }, types: {}, keys: ["name"] },
      },
    ],
    render: render as never,
  };
  try {
    const first = new ObjectPreviewWidget(stub as never, preview);
    const dom = first.toDOM(view);
    await Promise.resolve();
    // An equal widget: CodeMirror may hand it the DOM without updateDOM
    const second = new ObjectPreviewWidget(stub as never, { ...preview });
    expect(first.eq(second)).toBe(true);

    // The user changed the DOM: it matches no source now
    await contexts[0].set("name", "Alicia").catch(() => {});
    const fresh = new ObjectPreviewWidget(stub as never, { ...preview });
    expect(second.eq(fresh)).toBe(false);

    second.destroy(dom);
    expect(destroyed).toEqual(created);
  } finally {
    view.destroy();
  }
});

test("a focused form follows its source when preceding text moves", async () => {
  const localSyscall = vi.fn(async (..._args: unknown[]) => {});
  const { contexts, mount } = harness(localSyscall);
  vi.useFakeTimers();
  const original = `Before\n\n${doc}`;
  const view = mount(original);
  try {
    await vi.runAllTimersAsync();
    const container = view.dom.querySelector(".sb-object-preview")!;
    const input = document.createElement("input");
    container.appendChild(input);
    input.focus();
    const prefix = "Heading\n\n";
    view.dispatch({ changes: { from: 0, insert: prefix } });
    await vi.runAllTimersAsync();
    expect(view.dom.querySelector(".sb-object-preview")).toBe(container);
    await contexts[0].set("name", "Updated");
    expect(localSyscall).toHaveBeenCalledWith("object.update", [
      expect.objectContaining({
        ref: `${PAGE}@${prefix.length + original.indexOf("name: Alice")}`,
      }),
      { name: "Updated" },
      { remove: [] },
    ]);
  } finally {
    view.destroy();
    vi.useRealTimers();
  }
});

test("a blur commit retains its mount until the queued write lands", async () => {
  const localSyscall = vi.fn(async (..._args: unknown[]) => {});
  const { contexts, mount } = harness(localSyscall);
  vi.useFakeTimers();
  const view = mount(doc);
  const outside = document.createElement("input");
  document.body.appendChild(outside);
  try {
    await vi.runAllTimersAsync();
    const container = view.dom.querySelector(".sb-object-preview")!;
    const field = document.createElement("input");
    container.appendChild(field);
    field.focus();
    const write = contexts[0].set("name", "Updated");
    outside.focus();
    view.dispatch({});
    await expect(write).resolves.toBeUndefined();
    expect(localSyscall).toHaveBeenCalledWith("object.update", [
      expect.objectContaining({ ref: `${PAGE}@${doc.indexOf("name: Alice")}` }),
      { name: "Updated" },
      { remove: [] },
    ]);
    await vi.runAllTimersAsync();
    expect(container.isConnected).toBe(false);
  } finally {
    view.destroy();
    outside.remove();
    vi.useRealTimers();
  }
});

test("the first value of an empty item is written as YAML text", async () => {
  const localSyscall = vi.fn(async (..._args: unknown[]) => {});
  const { contexts, mount } = harness(localSyscall);
  vi.useFakeTimers();
  const view = mount("```#contact\n\n```\nOutro");
  try {
    await vi.runAllTimersAsync();
    expect(contexts[0].keys).toEqual([]);
    await contexts[0].set("name", "Ann");
    expect(view.state.doc.toString()).toBe(
      "```#contact\nname: Ann\n```\nOutro",
    );
    // There was no object to update yet
    expect(localSyscall).not.toHaveBeenCalled();
  } finally {
    view.destroy();
    vi.useRealTimers();
  }
});

test("only the last item can add one; nothing is written until its first value", async () => {
  const { contexts, mount } = harness(vi.fn(async () => {}));
  vi.useFakeTimers();
  const view = mount(doc);
  try {
    await vi.runAllTimersAsync();
    expect(contexts.map((ctx) => typeof ctx.addItem)).toEqual([
      "undefined",
      "function",
    ]);
    await contexts[1].addItem();
    await vi.runAllTimersAsync();
    // An empty item shows, but the page is unchanged
    expect(view.state.doc.toString()).toBe(doc);
    const added = contexts.at(-1);
    expect(added.keys).toEqual([]);
    expect(added.addItem).toBeUndefined();
    // Its first value goes in with the --- line, on lines of their own
    await added.set("$ref", "zef");
    expect(view.state.doc.toString()).toBe(
      doc.replace("name: Bob\n```", "name: Bob\n---\n$ref: zef\n```"),
    );
  } finally {
    view.destroy();
    vi.useRealTimers();
  }
});

test("leaving an added item with nothing written drops it", async () => {
  const { mount, contexts } = harness(vi.fn(async () => {}));
  vi.useFakeTimers();
  const view = mount(doc);
  const outside = document.createElement("input");
  document.body.appendChild(outside);
  try {
    await vi.runAllTimersAsync();
    await contexts[1].addItem();
    await vi.runAllTimersAsync();
    const items = () =>
      view.dom.querySelectorAll(".sb-object-preview-item").length;
    expect(items()).toBe(3);
    const container = view.dom.querySelector(".sb-object-preview")!;
    const field = document.createElement("input");
    container.appendChild(field);
    field.focus();
    outside.focus();
    container.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }),
    );
    await vi.runAllTimersAsync();
    expect(items()).toBe(2);
    expect(view.state.doc.toString()).toBe(doc);
  } finally {
    view.destroy();
    outside.remove();
    vi.useRealTimers();
  }
});

const removeItem = (index: number) =>
  (created[index] as any).options.host.remove() as Promise<void>;

test("Delete on a data item asks object.delete for that item", async () => {
  const localSyscall = vi.fn(async (..._args: unknown[]) => {});
  const { mount } = harness(localSyscall);
  vi.useFakeTimers();
  const view = mount(doc);
  try {
    await vi.runAllTimersAsync();
    await removeItem(1);
    expect(localSyscall).toHaveBeenCalledWith("object.delete", [
      expect.objectContaining({
        ref: `${PAGE}@${doc.indexOf("\nname: Bob")}`,
        name: "Bob",
      }),
    ]);
  } finally {
    view.destroy();
    vi.useRealTimers();
  }
});

test("Delete on the only, empty item removes the block", async () => {
  const localSyscall = vi.fn(async (..._args: unknown[]) => {});
  const { mount } = harness(localSyscall);
  vi.useFakeTimers();
  const view = mount("```#contact\n\n```\nOutro");
  try {
    await vi.runAllTimersAsync();
    await removeItem(0);
    expect(view.state.doc.toString()).toBe("Outro");
    expect(localSyscall).not.toHaveBeenCalled();
  } finally {
    view.destroy();
    vi.useRealTimers();
  }
});

test("Delete on an unwritten added item just drops it", async () => {
  const localSyscall = vi.fn(async (..._args: unknown[]) => {});
  const { contexts, mount } = harness(localSyscall);
  vi.useFakeTimers();
  const view = mount(doc);
  try {
    await vi.runAllTimersAsync();
    await contexts[1].addItem();
    await vi.runAllTimersAsync();
    const items = () =>
      view.dom.querySelectorAll(".sb-object-preview-item").length;
    expect(items()).toBe(3);
    await removeItem(created.length - 1);
    await vi.runAllTimersAsync();
    expect(items()).toBe(2);
    expect(view.state.doc.toString()).toBe(doc);
    expect(localSyscall).not.toHaveBeenCalled();
  } finally {
    view.destroy();
    vi.useRealTimers();
  }
});
