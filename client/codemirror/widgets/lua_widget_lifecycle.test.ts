// @vitest-environment happy-dom
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import type { EventHookT } from "@silverbulletmd/silverbullet/type/manifest";
import { EventInterest } from "../../event_interest.ts";
import { createRenderContext } from "../../markdown_renderer/compose.ts";
import { EventHook } from "../../plugos/hooks/event.ts";
import { System } from "../../plugos/system.ts";
import { WidgetCache } from "../../widget_cache.ts";
import type { Tracker } from "../../space_lua/dependencies.ts";
import { evalExpression } from "../../space_lua/eval.ts";
import { makeFragment } from "../../space_lua/fragment.ts";
import { parseExpressionString } from "../../space_lua/parse.ts";
import { LuaStackFrame, type LuaTable } from "../../space_lua/runtime.ts";
import { newView } from "../../navigator/view_value.ts";
import {
  buildTestEnv,
  type TestEnv,
  testHost,
} from "../../markdown_renderer/compose_test_env.ts";

let env: TestEnv;

let sandboxes = 0;
vi.mock("../../markdown_renderer/compose_client.ts", () => ({
  liveContextForClient: () =>
    createRenderContext(
      testHost(env, {
        // Like the real host: keyed by content, sized by a changing cache
        createSandbox: (w) => {
          const el = document.createElement("div");
          el.dataset.sandboxContent = String(w.html);
          el.style.height = `${++sandboxes * 10}px`;
          return el;
        },
      }),
      { hostPage: { name: "Host" } },
    ),
}));
vi.mock("../../sandbox/widget_sandbox_iframe.ts", () => ({
  createWidgetSandboxIFrame: vi.fn(),
}));

const { LuaWidget, OccurrenceKeys } = await import("./lua_widget.ts");
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
  const hook = new EventHook();
  new System<EventHookT>(undefined).addHook(hook);
  const interest = new EventInterest(hook);
  return {
    eventHook: Object.assign(hook, {
      emit(name: string) {
        void hook.dispatchEvent(name);
      },
    }),
    eventInterest: interest,
    widgetCache: new WidgetCache({ set: async () => {} } as any, interest),
    listenerCount: (name: string) =>
      (hook as any).localListeners.get(name)?.length ?? 0,
    currentName: () => "Host",
    currentPageMeta: () => ({ name: "Host" }),
    editorView: {
      composing: true,
      dispatch: () => {},
      requestMeasure: () => {},
    },
    isReadOnlyMode: () => false,
    ui: { flashNotification: vi.fn() },
    clientSystem: {
      localSyscall: vi.fn(async () => {}),
    },
  };
}
type FakeClient = ReturnType<typeof makeClient>;

function widget(
  client: FakeClient,
  callback: (...args: any[]) => Promise<unknown>,
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

// A callback that reads the index, so index events re-run it
const tracked =
  <T>(value: () => T) =>
  async (_body: string, _page: string, track: Tracker) => {
    track("index");
    return value();
  };

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

test("a remounted widget shows its cached result, then re-runs once if it missed an event", async () => {
  const client = makeClient();
  let n = 0;
  let gate: Promise<void> = Promise.resolve();
  const calls = vi.fn(async (_b: string, _p: string, track: Tracker) => {
    const mine = ++n;
    track("index");
    await gate;
    return `${mine}`;
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

test("in a hidden tab, tracked events wait for the tab to show and re-run once", async () => {
  const client = makeClient();
  let n = 0;
  const calls = vi.fn(tracked(() => `${++n}`));
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
  const calls = vi.fn(
    tracked(() => ({
      _isWidget: true,
      markdown: `# Row ${++n}`,
      display: "block",
    })),
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
    tracked(() => {
      if (++n > 1) throw new Error("boom");
      return "ok";
    }),
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
  const calls = async (_b: string, _p: string, track: Tracker) => {
    const mine = ++n;
    track("index");
    await gate;
    return { _isWidget: true, markdown: `run ${mine}`, display: "block" };
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

test("a remounted widget that rendered empty re-runs once if it missed an event", async () => {
  const client = makeClient();
  let n = 0;
  const calls = vi.fn(async (_b: string, _p: string, track: Tracker) => {
    const mine = ++n;
    track("index");
    return { _isWidget: true, markdown: mine === 1 ? "" : `run ${mine}` };
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

test("a widget that read a page scope re-runs when it changes, until destroyed", async () => {
  const client = makeClient();
  let n = 0;
  const reads = widget(client, (async (
    _body: string,
    _page: string,
    track: (event: string) => void,
  ) => {
    track("pageScope:changed:Budget");
    return `${++n}`;
  }) as any);
  const other = counter();
  const unrelated = widget(client, other, "lua:y:Host");
  mount(reads);
  mount(unrelated);
  await flush();
  expect(text(reads)).toBe("1");
  client.eventHook.emit("pageScope:changed:Budget");
  await debounce();
  expect(text(reads)).toBe("2");
  expect(other).toHaveBeenCalledOnce();
  // The read is recorded again by the re-run, and dropped with the widget
  expect(client.listenerCount("pageScope:changed:Budget")).toBeGreaterThan(0);
  reads.destroy();
  unrelated.destroy();
  // Only the shared event counter stays (see live_binding.ts)
  expect(client.listenerCount("pageScope:changed:Budget")).toBe(1);
});

test("destroying every widget leaves no listeners behind", async () => {
  const client = makeClient();
  const base = client.eventHook.listenerCount();
  const widgets = Array.from({ length: 20 }, (_, i) =>
    widget(
      client,
      (async (_b: string, _p: string, track: Tracker) => {
        track(`index:tag:t${i}`);
        return "v";
      }) as any,
      `lua:k${i}:Host`,
    ),
  );
  const doms = widgets.map((w) => mount(w));
  await flush();
  expect(client.eventHook.listenerCount().names).toBeGreaterThan(base.names);
  for (const [i, w] of widgets.entries()) w.destroy(doms[i]);
  client.widgetCache.clearPrewarm();
  expect(client.eventHook.listenerCount()).toEqual(base);
});

test("a triggered re-run with identical output keeps the shown node", async () => {
  const client = makeClient();
  const w = widget(client, async () => "**same**", "lua:same:Host");
  mount(w);
  await flush();
  const before = w.contentDiv!.querySelector("strong")!;
  await w.reload({ keepIfUnchanged: true });
  expect(w.contentDiv!.contains(before)).toBe(true);
  w.destroy();
});

test("a changed result, a menu Reload, or a view always commits", async () => {
  const client = makeClient();
  let n = 0;
  let same = false;
  const w = widget(
    client,
    async () => (same ? "**fixed**" : `**v${n++}**`),
    "lua:changing:Host",
  );
  mount(w);
  await flush();
  await w.reload({ keepIfUnchanged: true });
  expect(text(w)).toContain("v1");
  same = true;
  await w.reload({ keepIfUnchanged: true });
  const shown = w.contentDiv!.querySelector("strong");
  await w.reload();
  expect(w.contentDiv!.querySelector("strong")).not.toBe(shown);
  w.destroy();
});

test("an unchanged sandbox is kept; changed sandbox content commits", async () => {
  const client = makeClient();
  let html = "<p>a</p>";
  const w = widget(
    client,
    async () => ({ _isWidget: true, html, sandbox: true }),
    "lua:sandbox:Host",
  );
  mount(w);
  await flush();
  const host = w.contentDiv!.querySelector("[data-sandbox-content]")!;
  await w.reload({ keepIfUnchanged: true });
  expect(w.contentDiv!.contains(host)).toBe(true);
  html = "<p>b</p>";
  await w.reload({ keepIfUnchanged: true });
  expect(w.contentDiv!.contains(host)).toBe(false);
  w.destroy();
});

test("a fragment containing a view always commits", async () => {
  const client = makeClient();
  const spec = await evalExpression(
    parseExpressionString("{ source = function() return {} end }"),
    env.env,
    LuaStackFrame.createWithGlobalEnv(env.env),
  );
  const w = widget(
    client,
    async () => makeFragment(["x ", newView(spec as LuaTable)]),
    "lua:view:Host",
  );
  mount(w);
  await flush();
  const before = w.contentDiv!.querySelector(".sb-inline-view");
  expect(before).not.toBeNull();
  await w.reload({ keepIfUnchanged: true });
  expect(w.contentDiv!.querySelector(".sb-inline-view")).not.toBe(before);
  w.destroy();
});

test("an event that fires while a re-run is evaluating triggers another re-run", async () => {
  const client = makeClient();
  let n = 0;
  const calls = vi.fn(async (_b: string, _p: string, track: Tracker) => {
    const mine = ++n;
    track("index:tag:t");
    // The index changes again after this run read it
    if (mine === 2) client.eventHook.emit("index:tag:t");
    return `${mine}`;
  });
  const w = widget(client, calls, "lua:race:Host");
  mount(w);
  await flush();
  client.eventHook.emit("index:tag:t");
  await debounce();
  await flush();
  await debounce();
  await flush();
  expect(calls).toHaveBeenCalledTimes(3);
  expect(text(w)).toBe("3");
  w.destroy();
});

test("identical expressions keyed per occurrence each show their own element", async () => {
  const client = makeClient();
  const keys = new OccurrenceKeys();
  const render = async () => ({
    _isWidget: true,
    html: Object.assign(document.createElement("marquee"), {
      textContent: "Sup",
    }),
  });
  const first = widget(client, render, keys.key("lua:m:Host"));
  const second = widget(client, render, keys.key("lua:m:Host"));
  mount(first);
  mount(second);
  await flush();
  expect(first.contentDiv!.querySelector("marquee")).not.toBeNull();
  expect(second.contentDiv!.querySelector("marquee")).not.toBeNull();
  first.destroy();
  second.destroy();
});

test("occurrence keys: the first copy keeps the plain key", () => {
  const keys = new OccurrenceKeys();
  expect(keys.key("a")).toBe("a");
  expect(keys.key("b")).toBe("b");
  expect(keys.key("a")).toBe("a:dup1");
  expect(keys.key("a")).toBe("a:dup2");
});

test("a reload holds the widget's height border-box, then lets go", async () => {
  const client = makeClient();
  let release!: () => void;
  let first = true;
  const w = widget(client, async () => {
    if (first) {
      first = false;
      return "**v**";
    }
    await new Promise<void>((r) => {
      release = r;
    });
    return "**v2**";
  });
  mount(w);
  await flush();
  const div = w.contentDiv!;
  const reloading = w.reload();
  // offsetHeight includes the frame's border, so a content-box hold would grow it
  expect(div.style.boxSizing).toBe("border-box");
  expect(div.style.minHeight).toBe(`${div.offsetHeight}px`);
  release();
  await reloading;
  expect(div.style.boxSizing).toBe("");
  expect(div.style.minHeight).toBe("");
  w.destroy();
});
