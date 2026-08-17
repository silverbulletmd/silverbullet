import { beforeEach, expect, test, vi } from "vitest";

const datastore = {
  get: vi.fn<(key: unknown[]) => Promise<unknown>>(),
  set: vi.fn<(key: unknown[], value: unknown) => Promise<void>>(),
  del: vi.fn<(key: unknown[]) => Promise<void>>(),
};
const editor = {
  showPanel: vi.fn<(...args: unknown[]) => Promise<void>>(),
  flashNotification: vi.fn<(msg: string, kind?: string) => Promise<void>>(),
  isNarrowScreen: vi.fn<() => Promise<boolean>>(),
};
const events = {
  dispatchEvent: vi.fn<(name: string, data?: unknown) => Promise<unknown[]>>(),
};
const config = {
  set: vi.fn<(key: unknown, value: unknown) => Promise<void>>(),
};
const system = {
  invokeFunction:
    vi.fn<(name: string, ...args: unknown[]) => Promise<unknown>>(),
};

const registry = {
  resolveMeta: vi.fn<(name: string) => unknown>(),
  openOnStartViews: vi.fn<() => { name: string; dock: string }[]>(),
  unregister: vi.fn<(name: string) => void>(),
  register: vi.fn<(data: { meta: unknown }) => void>(),
  selectInFlight: vi.fn<(view: string) => Promise<unknown> | undefined>(),
};

vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  config,
  datastore,
  editor,
  events,
  system,
}));
vi.mock("@silverbulletmd/silverbullet/lib/panel_styles", () => ({
  panelStyles: vi.fn<() => Promise<string>>().mockResolvedValue(""),
}));
vi.mock("./registry.ts", () => registry);

// Resets modules so visibleSidebarView etc. start empty, like a freshly booted client.
async function freshNavigator() {
  vi.resetModules();
  return await import("./navigator.ts");
}

// Node has neither of these on the main thread; `afterQueuedMessages` needs a
// window-shaped pair that delivers a post as its own task, like a browser.
function stubWindowMessaging() {
  const listeners = new Set<(event: { data: unknown }) => void>();
  vi.stubGlobal("addEventListener", (type: string, fn: any) => {
    if (type === "message") listeners.add(fn);
  });
  vi.stubGlobal("removeEventListener", (type: string, fn: any) => {
    if (type === "message") listeners.delete(fn);
  });
  vi.stubGlobal("postMessage", (data: unknown) => {
    setTimeout(() => {
      for (const listener of [...listeners]) listener({ data });
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("")),
  );
  stubWindowMessaging();
  editor.isNarrowScreen.mockResolvedValue(false);
  registry.resolveMeta.mockReturnValue({ dock: "lhs", refreshOn: [] });
  registry.openOnStartViews.mockReturnValue([]);
  registry.selectInFlight.mockReturnValue(undefined);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// A fixed tick count was vacuous here (passed even with the guard removed) -- this waits for the guard's actual selectInFlight consult so a regression would make it fail.
test("a new pick opening in the same slot waits for a superseded pick's in-flight select before nulling it", async () => {
  const nav = await freshNavigator();
  registry.resolveMeta.mockReturnValue({ dock: "modal", refreshOn: [] });
  const { promise: inFlight, resolve: resolveInFlight } = deferred<unknown[]>();
  const { promise: consulted, resolve: markConsulted } = deferred<void>();
  registry.selectInFlight.mockImplementation((view: string) => {
    if (view !== "__pick:A") return undefined;
    markConsulted();
    return inFlight;
  });

  let firstSettled = false;
  const first = nav
    .pickOpen("__pick:A", { dock: "modal" }, {})
    .then((v: unknown) => {
      firstSettled = true;
      return v;
    });
  nav.pickOpen("__pick:B", { dock: "modal" }, {});

  await Promise.race([
    consulted,
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error('supersede never consulted selectInFlight("__pick:A")'),
          ),
        1000,
      ),
    ),
  ]);
  expect(firstSettled).toBe(false);

  resolveInFlight([]);
  expect(await first).toBeNull();
  expect(firstSettled).toBe(true);
});

test("a new pick opening in the same slot with no in-flight select for the previous one nulls it", async () => {
  const nav = await freshNavigator();
  registry.resolveMeta.mockReturnValue({ dock: "modal", refreshOn: [] });
  registry.selectInFlight.mockReturnValue(undefined);

  const first = nav.pickOpen("__pick:A", { dock: "modal" }, {});
  nav.pickOpen("__pick:B", { dock: "modal" }, {});

  expect(await first).toBeNull();
});

// A modal activation is all microtasks, so it can reach the supersede before
// the host's message loop has even delivered the select the panel dispatched
// first. The first consult therefore has to be allowed to miss: only a
// re-check behind the queued messages sees the select that is already on its
// way, and without one the pick is nulled out from under an answer.
test("a select that only registers after the first consult still wins the supersede", async () => {
  const nav = await freshNavigator();
  registry.resolveMeta.mockReturnValue({ dock: "modal", refreshOn: [] });
  const { promise: inFlight, resolve: resolveInFlight } = deferred<unknown[]>();
  let consults = 0;
  registry.selectInFlight.mockImplementation((view: string) => {
    if (view !== "__pick:A") return undefined;
    consults++;
    return consults === 1 ? undefined : inFlight;
  });

  let firstSettled = false;
  const first = nav
    .pickOpen("__pick:A", { dock: "modal" }, {})
    .then((v: unknown) => {
      firstSettled = true;
      return v;
    });
  nav.pickOpen("__pick:B", { dock: "modal" }, {});

  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(consults).toBeGreaterThan(1);
  expect(firstSettled).toBe(false);

  resolveInFlight([]);
  expect(await first).toBeNull();
  expect(firstSettled).toBe(true);
});

test("a pick whose view never opens resolves nil", async () => {
  const nav = await freshNavigator();
  registry.resolveMeta.mockReturnValue(undefined);

  expect(await nav.pickOpen("__pick:A", { dock: "modal" }, {})).toBeNull();
  expect(editor.showPanel).not.toHaveBeenCalled();
  expect(registry.unregister).toHaveBeenCalledWith("__pick:A");
});

test("resize re-derives the docked view from the datastore when module state is empty", async () => {
  const nav = await freshNavigator();
  datastore.get.mockResolvedValue("std.spaceTree");

  await nav.resize({ slot: "lhs", width: 300 });

  expect(editor.showPanel).toHaveBeenCalledWith(
    "lhs",
    "0 0 300px",
    expect.any(String),
    expect.any(String),
    expect.objectContaining({ key: "navigator:lhs" }),
  );
});

test("a stray resize with nothing docked in the slot (datastore agrees) is dropped", async () => {
  const nav = await freshNavigator();
  datastore.get.mockResolvedValue(undefined);

  await nav.resize({ slot: "lhs", width: 300 });

  expect(editor.showPanel).not.toHaveBeenCalled();
});

test("only the first post-wipe tick pays for the datastore read", async () => {
  const nav = await freshNavigator();
  datastore.get.mockResolvedValue("std.spaceTree");

  await nav.resize({ slot: "lhs", width: 300 });
  expect(datastore.get).toHaveBeenCalledTimes(1);

  await nav.resize({ slot: "lhs", width: 320 });
  expect(datastore.get).toHaveBeenCalledTimes(1);
  expect(editor.showPanel).toHaveBeenLastCalledWith(
    "lhs",
    "0 0 320px",
    expect.any(String),
    expect.any(String),
    expect.any(Object),
  );
});

test("a resize tick after a real close stays dropped, via the datastore fallback too", async () => {
  const nav = await freshNavigator();
  datastore.get.mockResolvedValue("std.spaceTree");
  await nav.open("std.spaceTree");
  await nav.panelHidden({ slot: "lhs" });
  datastore.get.mockResolvedValue(undefined);
  editor.showPanel.mockClear();

  await nav.resize({ slot: "lhs", width: 300 });

  expect(editor.showPanel).not.toHaveBeenCalled();
});

// Guards against a resolution storm: without a one-tick-only guard, every post-wipe drag tick re-resolves meta on every rAF frame for as long as the worker stays wiped.
test("only the first post-wipe tick resolves meta; later ticks don't", async () => {
  const nav = await freshNavigator();
  datastore.get.mockResolvedValue("std.spaceTree");

  await nav.resize({ slot: "lhs", width: 300 });
  expect(registry.resolveMeta).toHaveBeenCalledTimes(1);

  registry.resolveMeta.mockClear();
  await nav.resize({ slot: "lhs", width: 305 });
  await nav.resize({ slot: "lhs", width: 310 });
  expect(registry.resolveMeta).not.toHaveBeenCalled();
});

// Without this check, a resize landing here would re-derive the still-present datastore key and re-show (and re-arm) a panel that is actually closing.
test("a resize tick that starts after panelHidden has already marked the slot closing is dropped (first check)", async () => {
  const nav = await freshNavigator();
  datastore.get.mockResolvedValue("std.spaceTree");
  await nav.open("std.spaceTree");

  let resolveDel!: () => void;
  datastore.del.mockImplementation(
    () => new Promise<void>((resolve) => (resolveDel = resolve)),
  );
  const hiddenPromise = nav.panelHidden({ slot: "lhs" });

  datastore.get.mockResolvedValue("std.spaceTree");
  editor.showPanel.mockClear();

  await nav.resize({ slot: "lhs", width: 300 });
  expect(editor.showPanel).not.toHaveBeenCalled();

  resolveDel();
  await hiddenPromise;

  datastore.get.mockResolvedValue(undefined);
  await nav.resize({ slot: "lhs", width: 305 });
  expect(editor.showPanel).not.toHaveBeenCalled();
});

// Guards the narrower interleaving where panelHidden marks the slot closing while resize()'s own awaits (datastore.get, then viewMeta) are already in flight -- the first check alone would have passed clean here.
test("a resize tick whose own awaits are interleaved by a mid-flight close is dropped (second check)", async () => {
  const nav = await freshNavigator();

  let resolveGet!: (value: unknown) => void;
  datastore.get.mockImplementation(
    () => new Promise((resolve) => (resolveGet = resolve)),
  );
  let resolveDel!: () => void;
  datastore.del.mockImplementation(
    () => new Promise<void>((resolve) => (resolveDel = resolve)),
  );

  const resizePromise = nav.resize({ slot: "lhs", width: 300 });
  const hiddenPromise = nav.panelHidden({ slot: "lhs" });

  resolveGet("std.spaceTree");
  await resizePromise;
  expect(editor.showPanel).not.toHaveBeenCalled();

  resolveDel();
  await hiddenPromise;
});

test("resize after a wipe trusts the panel's reported view over a stale (pre-hop) datastore entry", async () => {
  const nav = await freshNavigator();
  datastore.get.mockResolvedValue("std.spaceTree");

  await nav.resize({ slot: "lhs", width: 321, view: "std.tagTree" });

  expect(datastore.get).not.toHaveBeenCalled();
  expect(editor.showPanel).toHaveBeenCalledWith(
    "lhs",
    "0 0 321px",
    expect.any(String),
    expect.any(String),
    expect.any(Object),
  );

  await nav.resize({
    slot: "lhs",
    width: 321,
    commit: true,
    view: "std.tagTree",
  });
  expect(datastore.set).toHaveBeenCalledWith(
    ["navigator", "std.tagTree", "width"],
    321,
  );
});

async function registeredCommands() {
  await freshNavigator();
  const { registerNavigatorCommands } = await import("./commands.ts");
  const commands = new Map<string, any>();
  registerNavigatorCommands({
    registerCommand: (command: any) => commands.set(command.name, command),
  } as any);
  return commands;
}

test.each([
  ["Navigate: Outline", "std.toc"],
  ["Navigate: Outline Picker", "std.tocModal"],
  ["Navigate: Tree", "std.spaceTree"],
])("%s opens %s and returns false, keeping the panel focused", async (command, view) => {
  const commands = await registeredCommands();

  expect(await commands.get(command).run()).toBe(false);
  expect(editor.showPanel).toHaveBeenCalled();
  // Pins the view: any of these wrappers would return false and call
  // showPanel, so those two alone don't prove which view was opened.
  expect(registry.resolveMeta).toHaveBeenCalledWith(view);
});

test("the space tree keeps both of its chords, on either platform", async () => {
  const tree = (await registeredCommands()).get("Navigate: Tree");

  expect(tree.key).toEqual(["Ctrl-o", "Ctrl-Shift-o"]);
  expect(tree.mac).toEqual(["Cmd-o", "Cmd-Shift-o"]);
});

test("defineView registers the view and mirrors its command into config", async () => {
  const nav = await freshNavigator();
  const { LuaEnv, LuaStackFrame } = await import("../space_lua/runtime.ts");
  const { luaBuildStandardEnv } = await import("../space_lua/stdlib.ts");
  const { parseBlock } = await import("../space_lua/parse.ts");
  const { evalExpression } = await import("../space_lua/eval.ts");
  const env = new LuaEnv(luaBuildStandardEnv());
  const node: any = parseBlock(
    `e({ name = "space.v", command = "Space: V", key = "Ctrl-j",
         source = function() return {} end, onSelect = function() end })`,
  ).statements[0];
  const spec = evalExpression(
    node.call.args[0],
    env,
    new LuaStackFrame(env, node.ctx),
  );

  await nav.defineView(spec);

  expect(registry.register).toHaveBeenCalledWith(
    expect.objectContaining({
      meta: expect.objectContaining({ name: "space.v", dock: "modal" }),
      spec,
    }),
  );
  // Exact keys, not objectContaining: an absent field reintroduced as
  // `undefined` fails config's own JSON-schema validation.
  const [path, command] = config.set.mock.calls[0];
  expect(path).toEqual(["commands", "Space: V"]);
  expect(Object.keys(command as object).sort()).toEqual(["key", "name", "run"]);
  expect(command).toMatchObject({ name: "Space: V", key: "Ctrl-j" });
});

test("openView refuses to open a pick view by name", async () => {
  const nav = await freshNavigator();

  expect(() => nav.openView("__pick:1:0.5")).toThrow(
    "navigator.open: '__pick:1:0.5' is a navigator.pick view",
  );
  expect(() => nav.openView("space.v", "modal")).toThrow(
    "navigator.open: opts must be a table",
  );
});
