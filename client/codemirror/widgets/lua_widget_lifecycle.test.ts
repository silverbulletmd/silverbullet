// @vitest-environment happy-dom
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { createRenderContext } from "../../markdown_renderer/compose.ts";
import {
  buildTestEnv,
  type TestEnv,
  testHost,
} from "../../markdown_renderer/compose_test_env.ts";

let env: TestEnv;

vi.mock("../../markdown_renderer/compose_client.ts", () => ({
  liveContextForClient: () =>
    createRenderContext(testHost(env), { hostPage: { name: "Host" } }),
}));
vi.mock("../../sandbox/widget_sandbox_iframe.ts", () => ({
  createWidgetSandboxIFrame: vi.fn(),
}));

const { LuaWidget } = await import("./lua_widget.ts");
const { reloadAllWidgets } = await import("./code_widget.ts");
type Widget = InstanceType<typeof LuaWidget>;

beforeAll(async () => {
  env = await buildTestEnv();
});

let hidden = false;
Object.defineProperty(document, "hidden", {
  configurable: true,
  get: () => hidden,
});

afterEach(() => {
  hidden = false;
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const flush = () => new Promise((r) => setTimeout(r, 15));
// Past the live refresh debounce (REFRESH_DEBOUNCE_MS)
const debounce = () => new Promise((r) => setTimeout(r, 350));

function makeClient() {
  const listeners = new Map<string, Set<() => void>>();
  const pending = new Map<
    string,
    { result: Promise<unknown>; at?: Map<string, number> }
  >();
  return {
    eventHook: {
      addLocalListener(name: string, fn: () => void) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(fn);
      },
      removeLocalListener(name: string, fn: () => void) {
        listeners.get(name)?.delete(fn);
      },
      emit(name: string) {
        for (const fn of [...(listeners.get(name) ?? [])]) fn();
      },
    },
    widgetCache: {
      prewarmResult(
        key: string,
        fn: () => Promise<unknown>,
        stamp?: () => Map<string, number>,
      ) {
        if (!pending.has(key))
          pending.set(key, { at: stamp?.(), result: fn() });
        return pending.get(key)!.result;
      },
      computedAt: (key: string) => pending.get(key)?.at,
      invalidatePrewarm(key: string) {
        pending.delete(key);
      },
      getCachedWidgetMeta: () => undefined,
      setCachedWidgetMeta: () => {},
      removeCachedWidgetMeta: () => {},
      getCachedWidgetHeight: () => -1,
    },
    currentName: () => "Host",
    currentPageMeta: () => ({ name: "Host" }),
    editorView: {
      composing: true,
      dispatch: () => {},
      requestMeasure: () => {},
    },
    isReadOnlyMode: () => false,
    ui: { flashNotification: vi.fn() },
    clientSystem: { localSyscall: vi.fn(async () => {}) },
  };
}
type FakeClient = ReturnType<typeof makeClient>;

function widget(
  client: FakeClient,
  callback: () => Promise<unknown>,
  cacheKey = "lua:x:Host",
): Widget {
  return new LuaWidget({
    client: client as any,
    cacheKey,
    expressionText: "x",
    callback: callback as any,
    host: { kind: "directive", wrappers: [] },
  });
}

function mount(w: Widget): HTMLElement {
  const dom = w.toDOM();
  document.body.append(dom);
  return dom;
}

const text = (w: Widget) =>
  w.contentDiv?.querySelector(".content")?.textContent ??
  w.contentDiv?.textContent;

const live = (value: unknown, refreshOn = ["index"]) => ({
  _isWidget: true,
  live: { value, refreshOn },
});

const counter = () => {
  let n = 0;
  const fn = vi.fn(async () => `${++n}`);
  return fn;
};

test("after Refresh All, a widget's own reload still re-runs it", async () => {
  const client = makeClient();
  const calls = counter();
  const w = widget(client, calls);
  mount(w);
  await flush();
  expect(text(w)).toBe("1");
  await reloadAllWidgets();
  expect(text(w)).toBe("2");
  await w.reload();
  expect(text(w)).toBe("3");
  w.destroy();
});

test("widget.live keeps the inner widget's classes and events", async () => {
  const client = makeClient();
  const click = vi.fn();
  const w = widget(client, async () =>
    live({
      _isWidget: true,
      markdown: "hi",
      cssClasses: ["hot"],
      events: { click },
    }),
  );
  mount(w);
  await flush();
  expect(w.contentDiv!.classList.contains("hot")).toBe(true);
  w.contentDiv!.click();
  expect(click).toHaveBeenCalledOnce();
  w.destroy();
});

test("rendering evaluates nested ${…} once; Copy computes its text when picked", async () => {
  await env.run("T.n = 0; function T.count() T.n = T.n + 1; return T.n end");
  const client = makeClient();
  const w = widget(client, async () => ({
    _isWidget: true,
    markdown: "Count ${T.count()}",
    display: "block",
  }));
  mount(w);
  await flush();
  expect(env.env.get("T").rawGet("n")).toBe(1);
  w.contentDiv!.querySelector<HTMLButtonElement>(
    "button[data-button]",
  )!.click();
  document.body.querySelector<HTMLElement>('[data-action="copy"]')!.click();
  await flush();
  expect(client.clientSystem.localSyscall).toHaveBeenCalledWith(
    "editor.copyToClipboard",
    ["Count 2"],
  );
  w.destroy();
});

test("a remounted live widget shows its cached result, then re-runs once if it missed an event", async () => {
  const client = makeClient();
  let n = 0;
  let gate: Promise<void> = Promise.resolve();
  const calls = vi.fn(async () => {
    const mine = ++n;
    await gate;
    return live(`${mine}`);
  });
  const first = widget(client, calls);
  const dom1 = mount(first);
  await flush();
  expect(text(first)).toBe("1");
  dom1.remove();
  first.destroy(dom1);

  client.eventHook.emit("file:changed");
  let open!: () => void;
  gate = new Promise((r) => {
    open = r;
  });
  const second = widget(client, calls);
  mount(second);
  await flush();
  expect(text(second)).toBe("1");
  expect(calls).toHaveBeenCalledTimes(2);
  open();
  await flush();
  expect(text(second)).toBe("2");
  expect(calls).toHaveBeenCalledTimes(2);
  const dom2 = second.dom!;
  dom2.remove();
  second.destroy(dom2);

  const third = widget(client, calls);
  mount(third);
  await flush();
  expect(text(third)).toBe("2");
  expect(calls).toHaveBeenCalledTimes(2);
  third.destroy();
});

test("in a hidden tab, live events wait for the tab to show and re-run once", async () => {
  const client = makeClient();
  let n = 0;
  const calls = vi.fn(async () => live(`${++n}`));
  const w = widget(client, calls, "lua:hidden:Host");
  mount(w);
  await flush();
  hidden = true;
  client.eventHook.emit("file:changed");
  await debounce();
  client.eventHook.emit("file:changed");
  await debounce();
  expect(calls).toHaveBeenCalledTimes(1);
  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  await flush();
  expect(calls).toHaveBeenCalledTimes(2);
  expect(text(w)).toBe("2");
  w.destroy();
});

test("destroying through a newer equal instance tears down the mounted one", async () => {
  const client = makeClient();
  let n = 0;
  const calls = vi.fn(async () =>
    live({ _isWidget: true, markdown: `# Row ${++n}`, display: "block" }),
  );
  const mounted = widget(client, calls, "lua:owner:Host");
  const dom = mount(mounted);
  await flush();
  dom.querySelector<HTMLButtonElement>("button[data-button]")!.click();
  expect(document.querySelector(".sb-dock-menu")).not.toBeNull();
  const newer = widget(client, calls, "lua:owner:Host");
  newer.destroy(dom);
  expect(document.querySelector(".sb-dock-menu")).toBeNull();
  client.eventHook.emit("file:changed");
  await debounce();
  expect(calls).toHaveBeenCalledTimes(1);
});

test("a failing live reload is logged, not left unhandled", async () => {
  const client = makeClient();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  let n = 0;
  const w = widget(
    client,
    async () => {
      if (++n > 1) throw new Error("boom");
      return live("ok");
    },
    "lua:fail:Host",
  );
  mount(w);
  await flush();
  client.eventHook.emit("file:changed");
  await debounce();
  await flush();
  expect(error).toHaveBeenCalledWith(
    "Live widget reload failed",
    expect.any(Error),
  );
  w.destroy();
});

test("reloads replace a widget's event handlers; destroy removes them", async () => {
  const client = makeClient();
  const click = vi.fn();
  const w = widget(
    client,
    async () => ({ _isWidget: true, markdown: "Tap", events: { click } }),
    "lua:events:Host",
  );
  mount(w);
  await flush();
  for (let i = 0; i < 3; i++) await w.reload();
  w.contentDiv!.click();
  expect(click).toHaveBeenCalledOnce();
  const div = w.contentDiv!;
  w.destroy();
  div.click();
  expect(click).toHaveBeenCalledOnce();
});

test("a re-render closes the open ⋯ menu when it commits; destroying through a newer instance does too", async () => {
  const client = makeClient();
  let n = 0;
  let gate: Promise<void> = Promise.resolve();
  const calls = async () => {
    const mine = ++n;
    await gate;
    return live({ _isWidget: true, markdown: `run ${mine}`, display: "block" });
  };
  const w = widget(client, calls, "lua:menu:Host");
  const dom = mount(w);
  await flush();
  const open = () =>
    w
      .contentDiv!.querySelector<HTMLButtonElement>("button[data-button]")!
      .click();
  open();
  expect(document.querySelectorAll(".sb-dock-menu")).toHaveLength(1);
  let release!: () => void;
  gate = new Promise((r) => {
    release = r;
  });
  client.eventHook.emit("file:changed");
  await debounce();
  expect(n).toBe(2);
  expect(document.querySelectorAll(".sb-dock-menu")).toHaveLength(1);
  release();
  await flush();
  expect(text(w)).toContain("run 2");
  expect(document.querySelector(".sb-dock-menu")).toBeNull();
  open();
  expect(document.querySelectorAll(".sb-dock-menu")).toHaveLength(1);
  widget(client, calls, "lua:menu:Host").destroy(dom);
  expect(document.querySelector(".sb-dock-menu")).toBeNull();
});

test("a remounted live widget that rendered empty re-runs once if it missed an event", async () => {
  const client = makeClient();
  let n = 0;
  const calls = vi.fn(async () => {
    const mine = ++n;
    return live({ _isWidget: true, markdown: mine === 1 ? "" : `run ${mine}` });
  });
  const first = widget(client, calls, "lua:empty:Host");
  const dom1 = mount(first);
  await flush();
  expect(text(first)).toBe("");
  dom1.remove();
  first.destroy(dom1);

  client.eventHook.emit("file:changed");
  const second = widget(client, calls, "lua:empty:Host");
  mount(second);
  await flush();
  await flush();
  expect(calls).toHaveBeenCalledTimes(2);
  expect(text(second)).toBe("run 2");
  second.destroy();
});

test("destroying a widget detaches a cached element so it can't pin the dead widget", async () => {
  const client = makeClient();
  const shared = document.createElement("div");
  shared.textContent = "cached";
  const calls = vi.fn(async () => ({ _isWidget: true, html: shared }));
  const w = widget(client, calls, "lua:shared:Host");
  const dom = mount(w);
  await flush();
  expect(dom.contains(shared)).toBe(true);
  w.destroy(dom);
  expect(shared.parentNode).toBeNull();
});

test("destroying a widget leaves a cached element another copy has mounted since", async () => {
  const client = makeClient();
  const shared = document.createElement("div");
  const calls = vi.fn(async () => ({ _isWidget: true, html: shared }));
  const first = widget(client, calls, "lua:twice:Host");
  const firstDom = mount(first);
  await flush();
  const second = widget(client, calls, "lua:twice:Host");
  const secondDom = mount(second);
  await flush();
  expect(secondDom.contains(shared)).toBe(true);
  first.destroy(firstDom);
  expect(secondDom.contains(shared)).toBe(true);
});
