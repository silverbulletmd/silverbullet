import { beforeEach, expect, test, vi } from "vitest";
import type { ViewMeta } from "../ui/types.ts";

const index = {
  isAvailable: vi.fn<() => Promise<boolean>>(),
  queryLuaObjects: vi.fn<(tag: string, query: unknown) => Promise<unknown[]>>(),
};
const space = {
  listPages: vi.fn<() => Promise<unknown[]>>(),
  listDocuments: vi.fn<() => Promise<unknown[]>>(),
};
const editor = {
  flashNotification: vi.fn<(msg: string, kind?: string) => Promise<void>>(),
  getUiOption: vi.fn<(name: string) => Promise<unknown>>(),
  getCurrentPath: vi.fn<() => Promise<string>>(),
};
const markdown = { parseMarkdown: vi.fn<(text: string) => Promise<unknown>>() };
const config = { get: vi.fn() };
const system = {
  getMode: vi.fn<() => Promise<string>>(),
  invokeFunction:
    vi.fn<(name: string, ...args: unknown[]) => Promise<unknown>>(),
};
const events = {
  dispatchEvent: vi.fn<(name: string, data?: unknown) => Promise<unknown[]>>(),
};
const open = vi.fn<(name: string, opts?: unknown) => Promise<boolean>>();

vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  index,
  space,
  config,
  editor,
  markdown,
  system,
  events,
}));
vi.mock("./navigator.ts", () => ({ open }));

const {
  register,
  unregister,
  resolveMeta,
  handle,
  openOnStartViews,
  selectInFlight,
} = await import("./registry.ts");
const { builtinMeta } = await import("./builtins.ts");

beforeEach(() => {
  vi.clearAllMocks();
  events.dispatchEvent.mockResolvedValue([undefined]);
});

function luaMeta(overrides: Partial<ViewMeta> = {}): ViewMeta {
  return {
    name: "test.view",
    title: "Test View",
    mode: "list",
    dock: "modal",
    hierarchy: { field: "name", separator: "/" },
    foldersFirst: true,
    expandAll: false,
    expansionScope: "view",
    followEditor: false,
    refreshOn: [],
    hasMove: false,
    hasCreate: false,
    refreshOnOpen: false,
    limit: 200,
    search: "client",
    hasRowIcon: false,
    pathCompletion: false,
    hashtagFilter: false,
    ...overrides,
  };
}

test("register rejects a name already claimed by a built-in", () => {
  expect(() => register({ meta: luaMeta({ name: "std.pages" }) })).toThrow(
    /std\.pages.*built-in/,
  );
  expect(resolveMeta("std.pages")).toEqual(builtinMeta("std.pages"));
});

test("register upserts a Lua view by name", () => {
  register({ meta: luaMeta({ name: "space.first", title: "First" }) });
  expect(resolveMeta("space.first")!.title).toBe("First");

  register({ meta: luaMeta({ name: "space.first", title: "Redefined" }) });
  expect(resolveMeta("space.first")!.title).toBe("Redefined");
});

test('resolveMeta and the "meta" hook resolve nothing for an unknown view', async () => {
  expect(resolveMeta("space.nope")).toBeUndefined();
  expect(await handle({ view: "space.nope", hook: "meta" })).toBeUndefined();
});

test('the "meta" hook resolves a Lua view without touching navigator:luaCall', async () => {
  register({ meta: luaMeta({ name: "space.meta-hook", title: "Hooked" }) });

  const meta = await handle({ view: "space.meta-hook", hook: "meta" });

  expect(meta.title).toBe("Hooked");
  expect(events.dispatchEvent).not.toHaveBeenCalled();
});

test("a non-meta hook for a Lua view dispatches exactly one navigator:luaCall", async () => {
  register({ meta: luaMeta({ name: "space.select-hook" }) });
  events.dispatchEvent.mockResolvedValue([{ picked: true }]);

  const result = await handle({
    view: "space.select-hook",
    hook: "select",
    args: { obj: { name: "x" } },
  });

  expect(result).toEqual({ picked: true });
  expect(events.dispatchEvent).toHaveBeenCalledWith("navigator:luaCall", {
    view: "space.select-hook",
    hook: "select",
    args: { obj: { name: "x" } },
  });
});

test("a non-meta hook for an unknown view never reaches navigator:luaCall", async () => {
  const result = await handle({ view: "space.nope", hook: "select" });

  expect(result).toBeUndefined();
  expect(events.dispatchEvent).not.toHaveBeenCalled();
});

test("a built-in hook is dispatched directly, without touching navigator:luaCall", async () => {
  editor.getCurrentPath.mockResolvedValue("assets/logo.png");

  const rows = await handle({ view: "std.toc", hook: "rows" });

  expect(rows).toEqual([]);
  expect(events.dispatchEvent).not.toHaveBeenCalled();
});

test("an ephemeral (navigator.pick) view registers and resolves like any other, then is gone once unregistered", async () => {
  const name = "__pick:1:0.5";
  register({ meta: luaMeta({ name, dock: "modal", ephemeral: true }) });

  expect(resolveMeta(name)?.ephemeral).toBe(true);
  expect(await handle({ view: name, hook: "meta" })).toEqual(
    expect.objectContaining({ ephemeral: true }),
  );

  unregister(name);

  expect(resolveMeta(name)).toBeUndefined();
  expect(await handle({ view: name, hook: "meta" })).toBeUndefined();
});

test("unregister is a harmless no-op for a name that was never registered", () => {
  expect(() => unregister("space.never-registered")).not.toThrow();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('selectInFlight tracks a "select" hook\'s dispatch, and clears once it settles', async () => {
  register({ meta: luaMeta({ name: "space.inflight" }) });
  const { promise, resolve } = deferred<unknown[]>();
  events.dispatchEvent.mockReturnValue(promise);

  const call = handle({ view: "space.inflight", hook: "select", args: {} });
  // Gives the mocked promise's .then microtask a tick to run before asserting the map is populated.
  await Promise.resolve();

  expect(selectInFlight("space.inflight")).toBeDefined();

  resolve([{ picked: true }]);
  await call;

  expect(selectInFlight("space.inflight")).toBeUndefined();
});

test("selectInFlight clears even when the dispatch rejects", async () => {
  register({ meta: luaMeta({ name: "space.inflight-reject" }) });
  const { promise, reject } = deferred<unknown[]>();
  events.dispatchEvent.mockReturnValue(promise);

  const call = handle({
    view: "space.inflight-reject",
    hook: "select",
    args: {},
  });
  await Promise.resolve();
  expect(selectInFlight("space.inflight-reject")).toBeDefined();

  reject(new Error("bridge down"));
  await expect(call).rejects.toThrow("bridge down");

  expect(selectInFlight("space.inflight-reject")).toBeUndefined();
});

test("selectInFlight is never populated for a non-select hook", async () => {
  register({ meta: luaMeta({ name: "space.inflight-rows" }) });
  events.dispatchEvent.mockResolvedValue([[]]);

  await handle({ view: "space.inflight-rows", hook: "rows", args: {} });

  expect(selectInFlight("space.inflight-rows")).toBeUndefined();
});

test("openOnStartViews lists only the Lua views declaring openOnStart, by name and dock", () => {
  register({
    meta: luaMeta({ name: "space.startup", dock: "rhs", openOnStart: true }),
  });
  register({ meta: luaMeta({ name: "space.not-startup", dock: "lhs" }) });

  expect(openOnStartViews()).toContainEqual({
    name: "space.startup",
    dock: "rhs",
  });
  expect(openOnStartViews().map((v) => v.name)).not.toContain(
    "space.not-startup",
  );
});
