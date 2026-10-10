// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";

const disposeRendered = vi.fn();
let nextKind = "markdown";
vi.mock("../../markdown_renderer/compose.ts", () => ({
  renderValue: async () => ({
    kind: nextKind,
    node: document.createElement("span"),
    block: nextKind === "view",
    copyMarkdown: "x",
    bakeable: nextKind !== "view",
    interactive: false,
    empty: false,
    chrome: {},
    fromWidget: true,
    live: undefined,
  }),
  disposeRendered: (n: Element) => disposeRendered(n),
  portableMarkdown: async () =>
    nextKind === "view"
      ? { ok: false, reason: "view" }
      : { ok: true, markdown: "x" },
}));
vi.mock("../../markdown_renderer/compose_client.ts", () => ({
  liveContextForClient: () => ({}),
}));
vi.mock("../../sandbox/widget_sandbox_iframe.ts", () => ({
  createWidgetSandboxIFrame: vi.fn(),
}));

const { LuaWidget } = await import("./lua_widget.ts");

test("re-rendering disposes views mounted by the previous content", async () => {
  const client = {
    widgetCache: { setCachedWidgetMeta: vi.fn() },
    editorView: { composing: true },
    currentName: () => "Host",
    isReadOnlyMode: () => false,
    eventHook: { addLocalListener() {}, removeLocalListener() {} },
  } as any;
  const w = new LuaWidget({
    client,
    cacheKey: "k",
    expressionText: "",
    callback: async () => ({ _isWidget: true, markdown: "x" }),
    host: { kind: "panel", definitionRef: null },
  });
  const div = document.createElement("div");
  await w.renderContent(div);
  disposeRendered.mockClear();
  await w.renderContent(div);
  expect(disposeRendered).toHaveBeenCalledWith(div);
});

test("views render through renderValue, tagged and with one ⋯ menu button", async () => {
  nextKind = "view";
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = observe;
      disconnect = disconnect;
    },
  );
  const client = {
    widgetCache: {
      setCachedWidgetMeta: vi.fn(),
      prewarmResult: (_k: string, f: () => Promise<unknown>) => f(),
    },
    editorView: { composing: true },
    currentName: () => "Host",
    isReadOnlyMode: () => false,
    eventHook: { addLocalListener() {}, removeLocalListener() {} },
  } as any;
  const w = new LuaWidget({
    client,
    cacheKey: "k",
    expressionText: "",
    callback: async () => ({ _isViewValue: true }) as any,
    host: { kind: "directive", wrappers: [] },
  });
  const div = document.createElement("div");
  await w.renderContent(div);
  expect(div.classList.contains("sb-lua-view")).toBe(true);
  expect(observe).toHaveBeenCalledWith(div);
  const buttons = [...div.querySelectorAll("button")].map((b) =>
    b.getAttribute("data-button"),
  );
  expect(buttons).toEqual(["menu"]);
  await w.renderContent(div);
  expect(disconnect).toHaveBeenCalled();
  nextKind = "markdown";
  await w.renderContent(div);
  expect(div.classList.contains("sb-lua-view")).toBe(false);
  vi.unstubAllGlobals();
});
