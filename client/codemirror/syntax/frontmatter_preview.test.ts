// @vitest-environment happy-dom

import { history, undo } from "@codemirror/commands";
import { EditorState, type StateField } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, test, vi } from "vitest";
import { buildExtendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import {
  frontmatterPreviewForState,
  frontmatterPreviewPlugin,
  parseFrontmatterPreview,
  selectFrontmatterRenderer,
} from "./frontmatter_preview.ts";
import { historyKey } from "./object_preview.ts";

vi.mock("../../sandbox/widget_sandbox_iframe.ts", () => ({
  createWidgetSandboxIFrame: vi.fn(),
}));

// Stand-in that shows what the callback returns when it is a DOM node
vi.mock("../widgets/lua_widget.ts", () => ({
  LuaWidget: class {
    constructor(private options: { callback: (...args: any[]) => any }) {}
    toDOM() {
      const div = document.createElement("div");
      void this.options
        .callback("", "", () => {})
        .then((result: unknown) => {
          if (result instanceof Node) div.appendChild(result);
        });
      return div;
    }
    destroy() {}
  },
}));

function state(doc: string) {
  return EditorState.create({
    doc,
    extensions: [buildExtendedMarkdownLanguage()],
  });
}

describe("frontmatter preview source", () => {
  test("reads values from the current document and supplies the page name", () => {
    const page = state("---\ntags: [team, featured]\npoints: 306\n---\nBody");
    expect(
      parseFrontmatterPreview(page, "Teams/Example")?.pageMeta,
    ).toMatchObject({
      name: "Teams/Example",
      tags: ["team", "featured"],
      points: 306,
    });

    const edited = page.update({
      changes: {
        from: page.doc.toString().indexOf("306"),
        to: page.doc.toString().indexOf("306") + 3,
        insert: "310",
      },
    }).state;
    expect(
      parseFrontmatterPreview(edited, "Teams/Example")?.pageMeta.points,
    ).toBe(310);
  });

  test("keeps first matching tag order for scalar and list forms", () => {
    const featured = () => "featured";
    const team = () => "team";
    const getRenderer = (tag: string) =>
      ({ featured, team })[tag as "featured" | "team"];
    const scalar = parseFrontmatterPreview(
      state('---\ntags: "featured, team"\n---\nBody'),
      "Teams/Example",
    );
    const list = parseFrontmatterPreview(
      state("---\ntags: [other, team, featured]\n---\nBody"),
      "Teams/Example",
    );
    expect(selectFrontmatterRenderer(scalar!.pageMeta, getRenderer)).toBe(
      featured,
    );
    expect(selectFrontmatterRenderer(list!.pageMeta, getRenderer)).toBe(team);
  });

  test("exposes raw values, YAML types and key order", () => {
    const parsed = parseFrontmatterPreview(
      state('---\ntags: a b\ndue: 2026-12-01\nwhen: "2026-12-01"\nn: 3\n---'),
      "Example",
    )!;
    expect(parsed.context.keys).toEqual(["tags", "due", "when", "n"]);
    expect(parsed.context.types).toEqual({
      tags: "string",
      due: "date",
      when: "string",
      n: "number",
    });
    expect(parsed.context.values.tags).toBe("a b");
    expect(parsed.context.values.due).toBe("2026-12-01");
    expect(parsed.pageMeta.tags).toEqual(["a", "b"]);
  });

  test("keeps keys, types and values aligned for dotted keys and timestamps", () => {
    const dotted = parseFrontmatterPreview(
      state("---\na.b: 1\nc: x\n---"),
      "Example",
    )!;
    expect(dotted.context.keys).toEqual(["a.b", "c"]);
    expect(dotted.context.types).toEqual({ "a.b": "number", c: "string" });
    expect(dotted.context.values).toEqual({ "a.b": 1, c: "x" });

    const stamp = parseFrontmatterPreview(
      state("---\nat: 2026-12-01T10:00:00Z\n---"),
      "Example",
    )!;
    expect(stamp.context.types.at).toBe("date");
    expect(stamp.context.values.at).toBe("2026-12-01T10:00:00.000Z");
  });

  test("falls back to the page tag renderer", () => {
    const pageRenderer = () => "page";
    const teamRenderer = () => "team";
    const getRenderer = (tag: string) =>
      ({ page: pageRenderer, team: teamRenderer })[tag as "page" | "team"];
    const untagged = parseFrontmatterPreview(
      state("---\ntitle: x\n---\nBody"),
      "Example",
    )!;
    const tagged = parseFrontmatterPreview(
      state("---\ntags: team\n---\nBody"),
      "Example",
    )!;
    expect(selectFrontmatterRenderer(untagged.pageMeta, getRenderer)).toBe(
      pageRenderer,
    );
    expect(selectFrontmatterRenderer(tagged.pageMeta, getRenderer)).toBe(
      teamRenderer,
    );
  });

  test("invalid YAML yields no preview", () => {
    expect(
      parseFrontmatterPreview(state('---\na: "unclosed\n---'), "Example"),
    ).toBeUndefined();
  });

  test("does not render incomplete, invalid, or non-object YAML", () => {
    expect(
      parseFrontmatterPreview(state("---\ntags: team"), "Example"),
    ).toBeUndefined();
    expect(
      parseFrontmatterPreview(state("---\ntags: [team\n---"), "Example"),
    ).toBeUndefined();
    expect(
      parseFrontmatterPreview(state("---\n- team\n---"), "Example"),
    ).toBeUndefined();
  });
});

describe("frontmatter preview policy", () => {
  const pageRender = () => "form";
  function client(
    options: {
      scriptsLoaded?: boolean;
      syntaxRendering?: boolean;
      renderWidgets?: boolean;
      settings?: Record<string, unknown>;
    } = {},
  ) {
    const render = () => "header";
    const values: Record<string, unknown> = {
      "tags.team.renderFrontmatter": render,
      "tags.page.renderFrontmatter": pageRender,
      ...options.settings,
    };
    return {
      currentName: () => "Teams/Example",
      currentPageMeta: () => ({
        pageDecoration: { renderWidgets: options.renderWidgets },
      }),
      config: {
        get(path: string | string[], fallback: unknown) {
          const key = Array.isArray(path) ? path.join(".") : path;
          return key in values ? values[key] : fallback;
        },
      },
      clientSystem: { scriptsLoaded: options.scriptsLoaded ?? true },
      ui: {
        viewState: {
          uiOptions: {
            markdownSyntaxRendering: options.syntaxRendering ?? false,
          },
        },
      },
      systemReady: true,
      fullIndexCompleted: true,
      pageListLoaded: true,
    };
  }

  const doc = "---\ntags: team\npoints: 306\n---\nBody";

  test("liveEdit.frontmatter turns off only the default form", () => {
    const at = (text: string) =>
      EditorState.create({
        doc: text,
        selection: { anchor: text.length },
        extensions: [buildExtendedMarkdownLanguage()],
      });
    const off = client({ settings: { "liveEdit.frontmatter": false } });
    const untagged = "---\npoints: 306\n---\nBody";
    expect(
      frontmatterPreviewForState(at(untagged), client() as never)?.render,
    ).toBe(pageRender);
    expect(
      frontmatterPreviewForState(at(untagged), off as never),
    ).toBeUndefined();
    // A tag's own renderer is an explicit opt-in
    expect(frontmatterPreviewForState(at(doc), off as never)).toBeDefined();
  });

  test("uses a renderer only outside the frontmatter in clean mode", () => {
    const outside = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [buildExtendedMarkdownLanguage()],
    });
    const inside = EditorState.create({
      doc,
      selection: { anchor: 5 },
      extensions: [buildExtendedMarkdownLanguage()],
    });
    expect(
      frontmatterPreviewForState(outside, client() as never)?.objects[0].object
        .points,
    ).toBe(306);
    expect(
      frontmatterPreviewForState(inside, client() as never),
    ).toBeUndefined();
  });

  test("shows the source when the cursor sits right after the closing fence", () => {
    const fenceEnd = doc.indexOf("---", 3) + 3;
    const atEdge = EditorState.create({
      doc,
      selection: { anchor: fenceEnd },
      extensions: [buildExtendedMarkdownLanguage()],
    });
    const bodyStart = EditorState.create({
      doc,
      selection: { anchor: fenceEnd + 1 },
      extensions: [buildExtendedMarkdownLanguage()],
    });
    expect(
      frontmatterPreviewForState(atEdge, client() as never),
    ).toBeUndefined();
    expect(
      frontmatterPreviewForState(bodyStart, client() as never),
    ).toBeDefined();
  });

  test("keeps source visible while scripts load or rendering is disabled", () => {
    const outside = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [buildExtendedMarkdownLanguage()],
    });
    expect(
      frontmatterPreviewForState(
        outside,
        client({ scriptsLoaded: false }) as never,
      ),
    ).toBeUndefined();
    expect(
      frontmatterPreviewForState(
        outside,
        client({ syntaxRendering: true }) as never,
      ),
    ).toBeUndefined();
    expect(
      frontmatterPreviewForState(
        outside,
        client({ renderWidgets: false }) as never,
      ),
    ).toBeUndefined();
  });

  test("replaces exactly the frontmatter source range", () => {
    const extension = frontmatterPreviewPlugin(client() as never);
    const editor = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [buildExtendedMarkdownLanguage(), extension],
    });
    const ranges: Array<[number, number]> = [];
    editor
      .field(extension as StateField<DecorationSet>)
      .between(0, doc.length, (from, to) => {
        ranges.push([from, to]);
      });
    expect(ranges).toEqual([[0, doc.indexOf("\nBody")]]);
  });

  test("Delete removes the frontmatter and the line break after it", () => {
    const text = "---\ntags: team\n---\nBody";
    const editor = EditorState.create({
      doc: text,
      selection: { anchor: text.length },
      extensions: [buildExtendedMarkdownLanguage()],
    });
    const { host } = frontmatterPreviewForState(editor, client() as never)!;
    const removed = (state: EditorState) => {
      const range = host.removal!(state, 0)!;
      return state.sliceDoc(0, range.from) + state.sliceDoc(range.to);
    };
    expect(removed(editor)).toBe("Body");
    // Frontmatter at the very end of the page has no line break after it
    expect(removed(state("---\ntags: team\n---"))).toBe("");
  });

  test("does not reuse a preview for another page with identical YAML", () => {
    const stub = client();
    let name = "Teams/First";
    stub.currentName = () => name;
    const extension = frontmatterPreviewPlugin(stub as never);
    const widgets: Array<{ eq: (other: unknown) => boolean }> = [];
    for (const pageName of ["Teams/First", "Teams/Second"]) {
      name = pageName;
      const editor = EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [buildExtendedMarkdownLanguage(), extension],
      });
      editor
        .field(extension as StateField<DecorationSet>)
        .between(0, doc.length, (_from, _to, decoration) => {
          widgets.push(decoration.spec.widget);
        });
    }
    expect(widgets[0].eq(widgets[1])).toBe(false);
  });
});

describe("frontmatter preview widget focus", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const doc = "---\ntags: team\npoints: 306\n---\nBody";

  const localSyscall = vi.fn(async (..._args: unknown[]) => {});

  function mount(
    render: (meta: Record<string, unknown>, context: any) => unknown,
  ) {
    const stub = {
      currentName: () => "Teams/Example",
      isReadOnlyMode: () => false,
      config: {
        get: (path: string[], fallback: unknown) =>
          path.join(".") === "tags.team.renderFrontmatter" ? render : fallback,
      },
      clientSystem: { scriptsLoaded: true, localSyscall },
      ui: { viewState: { uiOptions: { markdownSyntaxRendering: false } } },
      systemReady: true,
      fullIndexCompleted: true,
      pageListLoaded: true,
      currentPageMeta: () => ({}),
    };
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [
          buildExtendedMarkdownLanguage(),
          frontmatterPreviewPlugin(stub as never),
        ],
      }),
    });
    return { view, parent };
  }

  const flush = async () => {
    await vi.runAllTimersAsync();
  };

  test("keeps its DOM while focus is inside, then rebuilds on focus out", async () => {
    vi.useFakeTimers();
    let view: EditorView | undefined;
    try {
      const contexts: unknown[] = [];
      const mounted = mount((meta, context) => {
        contexts.push(context);
        const input = document.createElement("input");
        input.value = String(meta.points);
        return input;
      });
      view = mounted.view;
      const parent = mounted.parent;
      await flush();

      const input = parent.querySelector("input")!;
      expect(input.value).toBe("306");
      expect(contexts[0]).toMatchObject({
        readOnly: false,
        keys: ["tags", "points"],
      });
      input.focus();
      expect(document.activeElement).toBe(input);

      const at = doc.indexOf("306");
      view.dispatch({ changes: { from: at, to: at + 3, insert: "310" } });
      await flush();
      expect(input.isConnected).toBe(true);
      expect(document.activeElement).toBe(input);
      expect(parent.querySelector("input")).toBe(input);

      const outside = document.createElement("button");
      document.body.appendChild(outside);
      outside.focus();
      input.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }),
      );
      await flush();
      const rebuilt = parent.querySelector("input")!;
      expect(rebuilt).not.toBe(input);
      expect(rebuilt.value).toBe("310");
    } finally {
      view?.destroy();
      vi.useRealTimers();
    }
  });

  test("focus going to no element (a native picker) keeps the DOM until focus or a pointer lands outside", async () => {
    vi.useFakeTimers();
    let view: EditorView | undefined;
    try {
      const mounted = mount((meta) => {
        const input = document.createElement("input");
        input.value = String(meta.points);
        return input;
      });
      view = mounted.view;
      await flush();
      const input = mounted.parent.querySelector("input")!;
      input.focus();
      const at = doc.indexOf("306");
      view.dispatch({ changes: { from: at, to: at + 3, insert: "310" } });
      await flush();

      // iOS: the native date popover takes focus; focusout has no target
      input.blur();
      input.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
      );
      await flush();
      expect(mounted.parent.querySelector("input")).toBe(input);

      // Focus coming back inside cancels; nothing rebuilds
      input.focus();
      input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await flush();
      input.blur();
      input.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
      );
      await flush();
      expect(mounted.parent.querySelector("input")).toBe(input);

      // A tap outside rebuilds, picking up the edit made meanwhile
      const outside = document.createElement("div");
      document.body.appendChild(outside);
      outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await flush();
      const rebuilt = mounted.parent.querySelector("input")!;
      expect(rebuilt).not.toBe(input);
      expect(rebuilt.value).toBe("310");
    } finally {
      view?.destroy();
      vi.useRealTimers();
    }
  });

  test("a pending wait for focus to leave stops when the widget goes away", async () => {
    vi.useFakeTimers();
    let view: EditorView | undefined;
    const remove = vi.spyOn(document, "removeEventListener");
    try {
      const mounted = mount(() => document.createElement("input"));
      view = mounted.view;
      await flush();
      const input = mounted.parent.querySelector("input")!;
      input.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
      );
      remove.mockClear();
      view.destroy();
      view = undefined;
      const removed = remove.mock.calls.map((c) => c[0]);
      expect(removed).toContain("focusin");
      expect(removed).toContain("pointerdown");
    } finally {
      remove.mockRestore();
      view?.destroy();
      vi.useRealTimers();
    }
  });

  test("Escape in a field moves the cursor to that key's YAML value", async () => {
    vi.useFakeTimers();
    let view: EditorView | undefined;
    try {
      const mounted = mount((meta) => {
        const row = document.createElement("div");
        row.setAttribute("data-key", "points");
        const input = document.createElement("input");
        input.value = String(meta.points);
        row.appendChild(input);
        return row;
      });
      view = mounted.view;
      await flush();

      const input = mounted.parent.querySelector("input")!;
      input.focus();
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await flush();

      expect(view.state.selection.main.head).toBe(doc.indexOf("306"));
      expect(mounted.parent.querySelector("input")).toBeNull();
    } finally {
      view?.destroy();
      vi.useRealTimers();
    }
  });

  test("ctx writes the page through object.update", async () => {
    vi.useFakeTimers();
    let view: EditorView | undefined;
    try {
      localSyscall.mockClear();
      let ctx: any;
      const mounted = mount((_meta, context) => {
        ctx = context;
        return document.createElement("div");
      });
      view = mounted.view;
      await flush();

      expect(ctx.kind).toBe("page");
      await ctx.set("points", 310);
      await ctx.remove("tags");
      expect(localSyscall.mock.calls).toEqual([
        [
          "object.update",
          [
            { page: "Teams/Example", ref: "Teams/Example" },
            { points: 310 },
            { remove: [] },
          ],
        ],
        [
          "object.update",
          [
            { page: "Teams/Example", ref: "Teams/Example" },
            {},
            { remove: ["tags"] },
          ],
        ],
      ]);
    } finally {
      view?.destroy();
      vi.useRealTimers();
    }
  });
});

describe("undo and redo from inside the widget", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const doc = "---\ntags: team\npoints: 306\n---\nBody";
  const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? "");
  const modKey = (key: string, shiftKey = false) =>
    new KeyboardEvent("keydown", {
      key,
      shiftKey,
      metaKey: mac,
      ctrlKey: !mac,
      bubbles: true,
      cancelable: true,
    });

  async function setup() {
    vi.useFakeTimers();
    const render = () => {
      const row = document.createElement("div");
      const button = document.createElement("button");
      const field = document.createElement("textarea");
      field.value = "306";
      field.setAttribute("data-sb-committed", "306");
      row.append(button, field);
      return row;
    };
    const stub = {
      currentName: () => "Teams/Example",
      isReadOnlyMode: () => false,
      config: {
        get: (path: string[], fallback: unknown) =>
          path.join(".") === "tags.team.renderFrontmatter" ? render : fallback,
      },
      clientSystem: { scriptsLoaded: true },
      ui: { viewState: { uiOptions: { markdownSyntaxRendering: false } } },
      systemReady: true,
      fullIndexCompleted: true,
      pageListLoaded: true,
      currentPageMeta: () => ({}),
    };
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [
          history(),
          buildExtendedMarkdownLanguage(),
          frontmatterPreviewPlugin(stub as never),
        ],
      }),
    });
    await vi.runAllTimersAsync();
    // A form edit, as object.update makes it
    const at = doc.indexOf("306");
    view.dispatch({
      changes: { from: at, to: at + 3, insert: "310" },
      userEvent: "object.update",
    });
    await vi.runAllTimersAsync();
    return { view, parent };
  }

  test("Mod-z on a button undoes the page edit, Mod-Shift-z redoes it", async () => {
    const { view, parent } = await setup();
    try {
      const button = parent.querySelector("button")!;
      button.focus();
      button.dispatchEvent(modKey("z"));
      expect(view.state.doc.toString()).toBe(doc);
      await vi.runAllTimersAsync();
      // The widget was rebuilt; the next keys go to the editor
      const again = parent.querySelector("button")!;
      again.dispatchEvent(modKey("z", true));
      expect(view.state.doc.toString()).toContain("points: 310");
    } finally {
      view.destroy();
      vi.useRealTimers();
    }
  });

  test("a field with uncommitted text keeps its own undo; a clean one doesn't", async () => {
    const { view, parent } = await setup();
    try {
      const field = parent.querySelector("textarea")!;
      field.focus();
      field.value = "3061";
      const dirty = modKey("z");
      field.dispatchEvent(dirty);
      expect(dirty.defaultPrevented).toBe(false);
      expect(view.state.doc.toString()).toContain("points: 310");

      field.value = "306";
      field.dispatchEvent(modKey("z"));
      expect(view.state.doc.toString()).toBe(doc);
    } finally {
      view.destroy();
      vi.useRealTimers();
    }
  });

  test("beforeinput historyUndo (an Edit menu, a shake) goes to the page", async () => {
    const { view, parent } = await setup();
    try {
      const field = parent.querySelector("textarea")!;
      const event = new InputEvent("beforeinput", {
        inputType: "historyUndo",
        bubbles: true,
        cancelable: true,
      });
      field.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(view.state.doc.toString()).toBe(doc);
    } finally {
      view.destroy();
      vi.useRealTimers();
    }
  });

  test("a DOM the user changed is rebuilt after undo, from a fresh render", async () => {
    vi.useFakeTimers();
    let ctx: any;
    const render = (meta: Record<string, unknown>, context: any) => {
      ctx = context;
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = meta.points === 306;
      return box;
    };
    const localSyscall = vi.fn(async () => {});
    const stub = {
      currentName: () => "Teams/Example",
      isReadOnlyMode: () => false,
      config: {
        get: (path: string[], fallback: unknown) =>
          path.join(".") === "tags.team.renderFrontmatter" ? render : fallback,
      },
      clientSystem: { scriptsLoaded: true, localSyscall },
      ui: { viewState: { uiOptions: { markdownSyntaxRendering: false } } },
      systemReady: true,
      fullIndexCompleted: true,
      pageListLoaded: true,
      currentPageMeta: () => ({}),
    };
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: { anchor: doc.length },
        extensions: [
          history(),
          buildExtendedMarkdownLanguage(),
          frontmatterPreviewPlugin(stub as never),
        ],
      }),
    });
    try {
      await vi.runAllTimersAsync();
      const box = parent.querySelector("input")!;
      box.focus();
      // The user toggles it; the form writes, and the page changes
      box.checked = false;
      await ctx.set("points", 310);
      const at = doc.indexOf("306");
      view.dispatch({
        changes: { from: at, to: at + 3, insert: "310" },
        userEvent: "object.update",
      });
      await vi.runAllTimersAsync();
      // Focus is inside, so the changed DOM is kept
      expect(parent.querySelector("input")).toBe(box);

      box.dispatchEvent(modKey("z"));
      await vi.runAllTimersAsync();
      expect(view.state.doc.toString()).toBe(doc);
      const fresh = parent.querySelector("input")!;
      expect(fresh).not.toBe(box);
      expect(fresh.checked).toBe(true);

      // A later, unrelated transaction keeps showing the fresh render
      view.dispatch({ selection: { anchor: doc.length - 1 } });
      await vi.runAllTimersAsync();
      expect(parent.querySelector("input")!.checked).toBe(true);
    } finally {
      view.destroy();
      vi.useRealTimers();
    }
  });

  test("an undo in the body leaves an unfocused form alone", async () => {
    const { view, parent } = await setup();
    try {
      const before = parent.querySelector("button")!;
      view.dispatch({
        changes: { from: view.state.doc.length, insert: " more" },
        userEvent: "input.type",
      });
      undo(view);
      await vi.runAllTimersAsync();
      expect(parent.querySelector("button")).toBe(before);
    } finally {
      view.destroy();
      vi.useRealTimers();
    }
  });

  test("historyKey reads Mod-z, Mod-Shift-z and Mod-y per platform", () => {
    const k = (e: Partial<KeyboardEvent>, mac: boolean) =>
      historyKey(
        {
          key: "z",
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          ...e,
        },
        mac,
      );
    expect(k({ metaKey: true }, true)).toBe("undo");
    expect(k({ metaKey: true, shiftKey: true }, true)).toBe("redo");
    expect(k({ ctrlKey: true }, true)).toBeUndefined();
    expect(k({ ctrlKey: true }, false)).toBe("undo");
    expect(k({ ctrlKey: true, key: "y" }, false)).toBe("redo");
    expect(k({ metaKey: true, key: "y" }, true)).toBeUndefined();
    expect(k({ ctrlKey: true, key: "Z", shiftKey: true }, false)).toBe("redo");
    expect(k({ key: "z" }, false)).toBeUndefined();
  });
});
