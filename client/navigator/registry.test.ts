import { beforeEach, expect, test, vi } from "vitest";
import type { LuaFunctionCallStatement } from "../space_lua/ast.ts";
import { evalExpression } from "../space_lua/eval.ts";
import { parseBlock } from "../space_lua/parse.ts";
import {
  LuaEnv,
  LuaNativeJSFunction,
  LuaStackFrame,
  type LuaTable,
} from "../space_lua/runtime.ts";
import { luaBuildStandardEnv } from "../space_lua/stdlib.ts";
import type { ViewMeta } from "./types.ts";

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
  clearScriptViews,
  resolveMeta,
  handle,
  openOnStartViews,
  selectInFlight,
  loadContent,
  normalizeContent,
} = await import("./registry.ts");
const { builtinMeta } = await import("./builtins.ts");

beforeEach(() => {
  vi.clearAllMocks();
  editor.flashNotification.mockResolvedValue(undefined);
});

/** A real Lua table, closures and all -- the same value a view spec is. */
function luaSpec(
  source: string,
  globals: Record<string, (...args: any[]) => any> = {},
): LuaTable {
  const env = new LuaEnv(luaBuildStandardEnv());
  for (const [name, fn] of Object.entries(globals)) {
    env.set(name, new LuaNativeJSFunction(fn));
  }
  const node = parseBlock(`e(${source})`)
    .statements[0] as LuaFunctionCallStatement;
  return evalExpression(
    node.call.args[0],
    env,
    new LuaStackFrame(env, node.ctx),
  ) as LuaTable;
}

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

function registerLua(
  name: string,
  source: string,
  metaOverrides: Partial<ViewMeta> = {},
  globals: Record<string, (...args: any[]) => any> = {},
) {
  register({
    meta: luaMeta({ name, ...metaOverrides }),
    spec: luaSpec(source, globals),
  });
}

const INERT =
  "{ source = function() return {} end, onSelect = function() end }";

test("register rejects a name already claimed by a built-in", () => {
  expect(() =>
    register({ meta: luaMeta({ name: "std.pages" }), spec: luaSpec(INERT) }),
  ).toThrow(/std\.pages.*built-in/);
  expect(resolveMeta("std.pages")).toEqual(builtinMeta("std.pages"));
});

test("register upserts a Lua view by name", () => {
  registerLua("space.first", INERT, { title: "First" });
  expect(resolveMeta("space.first")!.title).toBe("First");

  registerLua("space.first", INERT, { title: "Redefined" });
  expect(resolveMeta("space.first")!.title).toBe("Redefined");
});

test('resolveMeta and the "meta" hook resolve nothing for an unknown view', async () => {
  expect(resolveMeta("space.nope")).toBeUndefined();
  expect(await handle({ view: "space.nope", hook: "meta" })).toBeUndefined();
});

test('the "meta" hook answers from the registry, without running the spec', async () => {
  const ran = vi.fn();
  registerLua(
    "space.meta-hook",
    "{ source = function() ran() return {} end, onSelect = function() end }",
    { title: "Hooked" },
    { ran },
  );

  const meta = await handle({ view: "space.meta-hook", hook: "meta" });

  expect(meta.title).toBe("Hooked");
  expect(ran).not.toHaveBeenCalled();
});

test("a non-meta hook for a Lua view runs that view's own closure", async () => {
  const picked = vi.fn();
  registerLua(
    "space.select-hook",
    "{ source = function() return {} end, onSelect = function(obj) picked(obj.name) return { picked = true } end }",
    {},
    { picked },
  );

  const result = await handle({
    view: "space.select-hook",
    hook: "select",
    args: { obj: { name: "x" } },
  });

  expect(result).toEqual({ picked: true });
  expect(picked).toHaveBeenCalledWith("x");
});

test("a non-meta hook for an unknown view resolves to nothing", async () => {
  expect(await handle({ view: "space.nope", hook: "select" })).toBeUndefined();
});

test("a built-in hook is dispatched to the built-in registry", async () => {
  index.isAvailable.mockResolvedValue(false);

  expect(await handle({ view: "std.anchors", hook: "rows" })).toEqual([]);
});

// std.toc used to be a built-in (client/navigator/views/toc.ts); it's now a
// Space Lua view (navigator.define in Widgets.md) keeping the historical
// name for persisted dock/width state, so registering it must no longer be
// rejected as a built-in name clash.
test("register no longer rejects std.toc now that it's a Lua view, not a built-in", () => {
  expect(() =>
    register({ meta: luaMeta({ name: "std.toc" }), spec: luaSpec(INERT) }),
  ).not.toThrow();
  expect(resolveMeta("std.toc")?.name).toBe("std.toc");
  unregister("std.toc");
});

test("an ephemeral (navigator.pick) view registers and resolves like any other, then is gone once unregistered", async () => {
  const name = "__pick:1:0.5";
  registerLua(name, INERT, { dock: "modal", ephemeral: true });

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

// A script reload re-evaluates every space script, which re-defines its views;
// a pending pick has a caller still awaiting it and is nobody's to retire.
test("a script reload clears Space Lua views but leaves a pending pick alone", () => {
  registerLua("space.scripted", INERT);
  registerLua("__pick:9:0.1", INERT, { ephemeral: true });

  clearScriptViews();

  expect(resolveMeta("space.scripted")).toBeUndefined();
  expect(resolveMeta("__pick:9:0.1")).toBeDefined();
  unregister("__pick:9:0.1");
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

test('selectInFlight tracks a "select" hook while it runs, and clears once it settles', async () => {
  const { promise, resolve } = deferred<unknown>();
  registerLua(
    "space.inflight",
    "{ source = function() return {} end, onSelect = function() return hold() end }",
    {},
    { hold: () => promise },
  );

  const call = handle({ view: "space.inflight", hook: "select", args: {} });

  // Synchronously, with no tick in between: a supersede that consults this
  // right after the panel dispatched a select has to see it. That used to be
  // covered by a drain that waited out the postMessage queue the select
  // crossed; direct calls replaced the drain with this ordering.
  expect(selectInFlight("space.inflight")).toBeDefined();

  resolve({ picked: true });
  await call;

  expect(selectInFlight("space.inflight")).toBeUndefined();
});

test("selectInFlight clears even when the dispatch rejects", async () => {
  const { promise, reject } = deferred<unknown>();
  registerLua(
    "space.inflight-reject",
    "{ source = function() return {} end, onSelect = function() return hold() end }",
    {},
    { hold: () => promise },
  );
  // The last thing between a throwing onSelect and a resolved dispatch: with
  // the flash itself failing, the whole hook rejects.
  editor.flashNotification.mockRejectedValue(new Error("flash down"));

  const call = handle({
    view: "space.inflight-reject",
    hook: "select",
    args: {},
  });
  await Promise.resolve();
  expect(selectInFlight("space.inflight-reject")).toBeDefined();

  reject(new Error("bridge down"));
  await expect(call).rejects.toThrow("flash down");

  expect(selectInFlight("space.inflight-reject")).toBeUndefined();
});

test("selectInFlight is never populated for a non-select hook", async () => {
  registerLua("space.inflight-rows", INERT);

  await handle({ view: "space.inflight-rows", hook: "rows", args: {} });

  expect(selectInFlight("space.inflight-rows")).toBeUndefined();
});

test("openOnStartViews lists only the Lua views declaring openOnStart, by name and dock", () => {
  registerLua("space.startup", INERT, { dock: "rhs", openOnStart: true });
  registerLua("space.not-startup", INERT, { dock: "lhs" });

  expect(openOnStartViews()).toContainEqual({
    name: "space.startup",
    dock: "rhs",
  });
  expect(openOnStartViews().map((v) => v.name)).not.toContain(
    "space.not-startup",
  );
});

test("loadContent runs a content view's own closure and hands back its markdown", async () => {
  registerLua(
    "space.content",
    '{ content = function(ctx) return "# Hi " .. ctx.phrase end }',
    { hasContent: true },
  );

  await expect(loadContent("space.content")).resolves.toEqual({
    markdown: "# Hi ",
  });
  await expect(
    loadContent("space.content", { phrase: "there" }),
  ).resolves.toEqual({ markdown: "# Hi there" });
});

test("loadContent turns a throwing content view into an error, not a rejection", async () => {
  registerLua(
    "space.content-boom",
    '{ content = function() error("nope") end }',
    {
      hasContent: true,
    },
  );

  const result = await loadContent("space.content-boom");
  expect(result.markdown).toBeUndefined();
  expect(String(result.error)).toContain("nope");
});

// A view that no longer exists (a script reload retired it mid-flight) answers
// `undefined`; every container reads that as "nothing to show", not a crash.
test("loadContent on an unknown view is empty markdown", async () => {
  await expect(loadContent("space.nope")).resolves.toEqual({ markdown: "" });
});

test("normalizeContent reads markdown, errors, and nothing at all", () => {
  expect(normalizeContent({ markdown: "# a" })).toEqual({ markdown: "# a" });
  expect(normalizeContent({ error: "broke" })).toEqual({ error: "broke" });
  expect(normalizeContent(undefined)).toEqual({ markdown: "" });
  expect(normalizeContent({})).toEqual({ markdown: "" });
});
