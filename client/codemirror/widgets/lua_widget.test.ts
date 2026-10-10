// @vitest-environment happy-dom
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";
import { afterEach, expect, test, vi } from "vitest";
import type { Client } from "../../client.ts";
import {
  createRenderContext,
  type RenderContext,
  type RenderedValue,
} from "../../markdown_renderer/compose.ts";
import {
  buildTestEnv,
  testHost,
} from "../../markdown_renderer/compose_test_env.ts";
import { extendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { newView } from "../../navigator/view_value.ts";
import { evalExpression } from "../../space_lua/eval.ts";
import { parseExpressionString } from "../../space_lua/parse.ts";
import { LuaStackFrame, type LuaTable } from "../../space_lua/runtime.ts";

let nextRender: Partial<RenderedValue> | undefined;
// The context Copy and Bake compute their text in
let liveCtx = {} as RenderContext;
vi.mock("../../markdown_renderer/compose.ts", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("../../markdown_renderer/compose.ts")>();
  return {
    ...real,
    renderValue: (...args: Parameters<typeof real.renderValue>) =>
      nextRender
        ? Promise.resolve({
            kind: "markdown",
            node: document.createElement("span"),
            block: true,
            copyMarkdown: "",
            bakeable: false,
            interactive: false,
            empty: false,
            chrome: {},
            fromWidget: true,
            ...nextRender,
          })
        : real.renderValue(...args),
  };
});
vi.mock("../../markdown_renderer/compose_client.ts", () => ({
  liveContextForClient: () => liveCtx,
}));
vi.mock("../../sandbox/widget_sandbox_iframe.ts", () => ({
  createWidgetSandboxIFrame: vi.fn(),
}));

const { LuaWidget } = await import("./lua_widget.ts");
type Widget = InstanceType<typeof LuaWidget>;

class ElementStub {
  children: ElementStub[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<
    string,
    (event: { stopPropagation: () => void }) => void
  >();
  className = "";
  innerHTML = "";
  type = "";

  appendChild(child: ElementStub) {
    this.children.push(child);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  addEventListener(
    name: string,
    listener: (event: { stopPropagation: () => void }) => void,
  ) {
    this.listeners.set(name, listener);
  }
}

/** Renders `widget` as if its value rendered to `rendered`; returns the content div. */
async function show(
  widget: Widget,
  rendered: Partial<RenderedValue>,
): Promise<HTMLElement> {
  const div = document.createElement("div");
  nextRender = rendered;
  try {
    await widget.renderContent(div);
  } finally {
    nextRender = undefined;
  }
  return div;
}

function menuButtons(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>("button[data-button]")];
}

/** Opens the widget's ⋯ menu and returns its action ids, in order. */
function openMenu(root: HTMLElement): string[] {
  const [button] = menuButtons(root);
  button.click();
  return [...document.body.querySelectorAll<HTMLElement>("[data-action]")].map(
    (el) => el.dataset.action!,
  );
}

function pick(action: string) {
  document.body
    .querySelector<HTMLElement>(`[data-action="${action}"]`)!
    .click();
}

afterEach(() => {
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  document.body.replaceChildren();
});

const BOTH = {
  kind: "markdown",
  bakeable: true,
  copyable: true,
  copyMarkdown: "x",
} as const;
const NONE = { bakeable: false, copyable: false, copyMarkdown: "" } as const;
// A list view copies its rows; a content view has no Copy; neither bakes
const VIEW = (rows: boolean) => ({
  kind: "view" as const,
  bakeable: false,
  copyable: rows,
  copyMarkdown: "",
});

/** A fake client for widgets that render `value`. */
function fakeClient(extra: Record<string, unknown> = {}) {
  return {
    isReadOnlyMode: () => false,
    widgetCache: {
      prewarmResult: (_key: string, fn: () => Promise<unknown>) => fn(),
      removeCachedWidgetMeta: () => {},
    },
    currentName: () => "Projects/Sketchbook",
    eventHook: { addLocalListener() {}, removeLocalListener() {} },
    ...extra,
  } as unknown as Client;
}

const someValue = async () => ({ _isWidget: true as const, markdown: "x" });

test("an out-of-page view widget can go to its definition", async () => {
  const navigate = vi.fn(async () => {});
  const ref = {
    path: "Test/Page.md",
    details: { type: "position" as const, pos: 33 },
  } as Ref;
  const widget = new LuaWidget({
    client: fakeClient({ navigate }),
    cacheKey: "test",
    expressionText: "",
    callback: someValue,
    host: { kind: "panel", definitionRef: ref },
  });
  const root = await show(widget, { ...VIEW(true), block: true });
  expect(menuButtons(root).map((b) => b.dataset.button)).toEqual(["menu"]);
  expect(openMenu(root)).toEqual(["definition", "reload", "copy"]);
  pick("definition");
  await Promise.resolve();
  expect(navigate).toHaveBeenCalledWith(ref);
  expect(document.querySelector(".sb-dock-menu")).toBeNull();
});

test("an in-page widget can edit a known source position without searching its text", async () => {
  const dispatch = vi.fn();
  const focus = vi.fn();
  const widget = new LuaWidget({
    client: fakeClient({ editorView: { dispatch }, focus }),
    cacheKey: "frontmatter",
    expressionText: "",
    callback: someValue,
    host: { kind: "frontmatter", editPos: 4, definitionRef: null },
  });
  const root = await show(widget, NONE);
  expect(openMenu(root)).toEqual(["edit", "reload"]);
  pick("edit");
  expect(dispatch).toHaveBeenCalledWith({ selection: { anchor: 4 } });
  expect(focus).toHaveBeenCalledOnce();
});

test("an inline out-of-page widget can go to its definition", async () => {
  const navigate = vi.fn(async () => {});
  const widget = new LuaWidget({
    client: fakeClient({ navigate }),
    cacheKey: "test",
    expressionText: "",
    callback: someValue,
    host: { kind: "panel", definitionRef: { path: "Test/Page.md" } },
  });
  const root = await show(widget, { ...NONE, block: false });
  expect(openMenu(root)).toEqual(["definition", "reload"]);
  pick("definition");
  await Promise.resolve();
  expect(navigate).toHaveBeenCalledWith({ path: "Test/Page.md" });
});

test("an in-page inline widget keeps its unwrapped content", async () => {
  const widget = new LuaWidget({
    client: fakeClient(),
    cacheKey: "test",
    expressionText: "",
    callback: someValue,
    host: {
      kind: "frontmatter",
      editPos: 4,
      definitionRef: { path: "Test/Page.md" },
    },
  });
  const content = document.createElement("span");
  const root = await show(widget, { ...NONE, block: false, node: content });
  expect([...root.childNodes]).toEqual([content]);
});

test("read-only mode leaves Copy and Reload but no editing actions", async () => {
  const widget = new LuaWidget({
    client: fakeClient({ isReadOnlyMode: () => true }),
    cacheKey: "test",
    expressionText: "q()",
    callback: someValue,
    host: { kind: "directive", wrappers: [] },
  });
  expect(openMenu(await show(widget, BOTH))).toEqual(["reload", "copy"]);
});

test("a frontmatter-style widget offers Go to definition before Edit, and no Copy", async () => {
  const navigate = vi.fn(async () => {});
  const ref = { path: "CONFIG.md" } as Ref;
  const widget = new LuaWidget({
    client: fakeClient({ navigate }),
    cacheKey: "frontmatter",
    expressionText: "",
    callback: someValue,
    host: { kind: "frontmatter", editPos: 4, definitionRef: ref },
  });
  const root = await show(widget, BOTH);
  expect(openMenu(root)).toEqual(["definition", "edit", "reload"]);
  expect(
    document.body.querySelector('[data-action="definition"]')?.textContent,
  ).toBe("Go to definition");
  pick("definition");
  await Promise.resolve();
  expect(navigate).toHaveBeenCalledWith(ref);
});

function directiveWidget(
  expressionText: string,
  extra: Record<string, unknown> = {},
  callback: () => Promise<unknown> = someValue,
) {
  const doc = `Intro\n\${${expressionText}}\nOutro`;
  const state = EditorState.create({
    doc,
    extensions: [extendedMarkdownLanguage],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const dispatch = vi.fn();
  const flashNotification = vi.fn();
  const widget = new LuaWidget({
    client: fakeClient({
      editorView: {
        dispatch,
        posAtDOM: () => doc.indexOf("$"),
        state,
      },
      focus: () => {},
      ui: { flashNotification },
      ...extra,
    }),
    cacheKey: `lua:${expressionText}`,
    expressionText,
    callback: callback as any,
    host: { kind: "directive", wrappers: [] },
  });
  widget.dom = document.createElement("span");
  return { widget, doc, dispatch, flashNotification };
}

test("a plain ${…} widget offers the full menu and Make live wraps its source", async () => {
  const { widget, doc, dispatch } = directiveWidget("q()");
  const root = await show(widget, BOTH);
  expect(root.querySelector(".sb-widget-live-dot")).toBeNull();
  expect(openMenu(root)).toEqual([
    "edit",
    "reload",
    "copy",
    "bake",
    "makeLive",
  ]);
  pick("makeLive");
  const from = doc.indexOf("$");
  expect(dispatch).toHaveBeenCalledWith({
    changes: {
      from,
      to: from + "${q()}".length,
      insert: "${widget.live(q())}",
    },
  });
});

test("a live widget shows its dot and info line, and Make static unwraps it", async () => {
  const { widget, dispatch } = directiveWidget('widget.live(q(), { "edit" })');
  const root = await show(widget, { ...BOTH, live: ["edit"] });
  expect(root.querySelector(".sb-widget-live-dot")).not.toBeNull();
  expect(openMenu(root)).toEqual([
    "edit",
    "reload",
    "copy",
    "bake",
    "makeStatic",
  ]);
  expect(document.body.querySelector(".sb-widget-menu-info")?.textContent).toBe(
    "Live · re-runs when this page is edited",
  );
  expect(
    document.body.querySelector('[data-action="reload"]')?.textContent,
  ).toBe("Reload now");
  pick("makeStatic");
  expect(dispatch.mock.calls[0][0].changes.insert).toBe("${q()}");
});

test("Make static on a widget that isn't a widget.live call leaves the text alone", async () => {
  const { widget, dispatch, flashNotification } = directiveWidget("q()");
  expect(
    openMenu(await show(widget, { ...BOTH, live: ["index"] })),
  ).not.toContain("makeStatic");
  await widget.runAction("makeStatic");
  expect(dispatch).not.toHaveBeenCalled();
  expect(flashNotification).toHaveBeenCalledWith(
    "This widget isn't live",
    "error",
  );
});

test("Reload re-runs only this widget", async () => {
  const { widget } = directiveWidget("q()");
  const root = await show(widget, BOTH);
  const reload = vi.spyOn(widget, "reload").mockResolvedValue();
  openMenu(root);
  pick("reload");
  expect(reload).toHaveBeenCalledOnce();
});

test("a list/tree/table view copies its rows; a content view has no Copy; neither offers Bake or Make live", async () => {
  const t = await buildTestEnv();
  const localSyscall = vi.fn(async () => {});
  const spec = await evalExpression(
    parseExpressionString(
      '{ source = function() return {{ name = "Alpha task" }} end }',
    ),
    t.env,
    LuaStackFrame.createWithGlobalEnv(t.env),
  );
  const { widget } = directiveWidget(
    "widget.new { source = src }",
    { clientSystem: { spaceLuaEnv: t.sle, localSyscall } },
    async () => newView(spec as LuaTable),
  );
  liveCtx = createRenderContext(testHost(t), {
    hostPage: { name: "Projects/Sketchbook" },
  });
  expect(openMenu(await show(widget, VIEW(true)))).toEqual([
    "edit",
    "reload",
    "copy",
  ]);
  pick("copy");
  await vi.waitFor(() =>
    expect(localSyscall).toHaveBeenCalledWith("editor.copyToClipboard", [
      "* Alpha task",
    ]),
  );
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  liveCtx = {} as RenderContext;
  expect(openMenu(await show(widget, VIEW(false)))).toEqual(["edit", "reload"]);
});

test("a widget live only through a nested widget.live offers neither Make live nor Make static", async () => {
  const { widget } = directiveWidget("{ widget.live(q()), 1 }");
  expect(openMenu(await show(widget, { ...BOTH, live: ["index"] }))).toEqual([
    "edit",
    "reload",
    "copy",
    "bake",
  ]);
});

test("Reload on a panel widget re-runs the widget hooks, since its result is a snapshot", async () => {
  const localSyscall = vi.fn(async () => {});
  const widget = new LuaWidget({
    client: fakeClient({ clientSystem: { localSyscall } }),
    cacheKey: "panel:0",
    expressionText: "",
    callback: someValue,
    host: { kind: "panel", definitionRef: null },
  });
  const root = await show(widget, BOTH);
  const reload = vi.spyOn(widget, "reload");
  openMenu(root);
  pick("reload");
  expect(reload).not.toHaveBeenCalled();
  expect(localSyscall).toHaveBeenCalledWith("system.invokeFunction", [
    "index.refreshWidgets",
  ]);
});

test("the menu closes when focus moves outside it", async () => {
  const { widget } = directiveWidget("q()");
  openMenu(await show(widget, BOTH));
  const elsewhere = document.createElement("input");
  document.body.append(elsewhere);
  elsewhere.focus();
  expect(document.querySelector(".sb-widget-menu")).toBeNull();
});

test("opening one widget menu closes another, and re-clicking toggles it shut", async () => {
  const a = directiveWidget("a()").widget;
  const b = directiveWidget("b()").widget;
  const rootA = await show(a, BOTH);
  const rootB = await show(b, BOTH);
  openMenu(rootA);
  openMenu(rootB);
  expect(document.querySelectorAll(".sb-dock-menu")).toHaveLength(1);
  expect(menuButtons(rootA)[0].getAttribute("aria-expanded")).toBe("false");
  menuButtons(rootB)[0].click();
  expect(document.querySelectorAll(".sb-dock-menu")).toHaveLength(0);
});

test("rendering an in-page widget holds awaitRenderSettled until its result arrives", async () => {
  const { awaitRenderSettled } = await import("./render_settle.ts");
  vi.stubGlobal("document", {
    createElement: () => Object.assign(new ElementStub(), { style: {} }),
  });
  let resolveResult!: (value: null) => void;
  const result = new Promise<null>((resolve) => {
    resolveResult = resolve;
  });
  try {
    const widget = new LuaWidget({
      client: {
        widgetCache: {
          prewarmResult: () => result,
          getCachedWidgetMeta: () => undefined,
          removeCachedWidgetMeta: () => {},
        },
        currentName: () => "Test/Page",
      } as unknown as Client,
      cacheKey: "slow",
      expressionText: "slowQuery()",
      callback: () => result,
      host: { kind: "code", codeText: "slowQuery()" },
    });
    widget.toDOM();
    let settled = false;
    const waiting = awaitRenderSettled({
      nextFrame: () => new Promise((resolve) => setTimeout(resolve, 1)),
      timeoutMs: 1000,
    }).then((value) => {
      settled = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    resolveResult(null);
    expect(await waiting).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a widget that renders a Lua error is marked with sb-lua-error, and unmarked once fixed", async () => {
  vi.stubGlobal("document", {
    createElement: () => Object.assign(new ElementStub(), { style: {} }),
  });
  const classes = new Set<string>();
  const div = {
    className: "",
    innerHTML: "",
    style: {},
    querySelectorAll: () => [],
    replaceChildren() {
      this.innerHTML = "";
    },
    classList: {
      toggle: (name: string, force: boolean) => {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains: (name: string) => classes.has(name),
    },
  };
  let result: string | null = "**Lua error:** boom";
  try {
    const widget = new LuaWidget({
      client: {
        widgetCache: {
          getCachedWidgetMeta: () => undefined,
          removeCachedWidgetMeta: () => {},
        },
        currentName: () => "Test/Page",
      } as unknown as Client,
      cacheKey: "err",
      expressionText: "boom()",
      callback: async () => result,
      host: { kind: "panel", definitionRef: null },
    });
    // The rest of rendering needs a full client; only the marker matters here.
    await widget.renderContent(div as unknown as HTMLElement).catch(() => {});
    expect(classes.has("sb-lua-error")).toBe(true);
    result = null;
    await widget.renderContent(div as unknown as HTMLElement);
    expect(classes.has("sb-lua-error")).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a sandbox offers no Make live, but a top-level live one keeps Make static", async () => {
  const sandbox = { kind: "sandbox", bakeable: false } as const;
  const plain = directiveWidget("widget.sandbox(s)").widget;
  expect(openMenu(await show(plain, sandbox))).toEqual(["edit", "reload"]);
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  const liveOne = directiveWidget("widget.live(widget.sandbox(s))").widget;
  expect(
    openMenu(await show(liveOne, { ...sandbox, live: ["index"] })),
  ).toEqual(["edit", "reload", "makeStatic"]);
});
