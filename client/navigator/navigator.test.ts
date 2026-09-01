import { beforeEach, expect, test, vi } from "vitest";

const datastore = {
  get: vi.fn<(key: unknown[]) => Promise<unknown>>(),
  set: vi.fn<(key: unknown[], value: unknown) => Promise<void>>(),
  del: vi.fn<(key: unknown[]) => Promise<void>>(),
};
const editor = {
  focus: vi.fn<() => Promise<void>>(),
  flashNotification: vi.fn<(msg: string, kind?: string) => Promise<void>>(),
};
const slots = {
  showSlot: vi.fn<(...args: unknown[]) => void>(),
  hideSlot: vi.fn<(slot: string) => void>(),
  focusedSlot: vi.fn<() => string | undefined>(),
};
const mobile = {
  isNarrowScreen: vi.fn<() => boolean>(),
};
const config = {
  set: vi.fn<(key: unknown, value: unknown) => Promise<void>>(),
};
const system = {
  invokeFunction:
    vi.fn<(name: string, ...args: unknown[]) => Promise<unknown>>(),
};
const space = {
  createRevisionSnapshot: vi.fn<() => Promise<boolean>>(),
};
const events = {
  dispatchEvent: vi.fn<(name: string, data: unknown) => Promise<unknown[]>>(),
};

const registry = {
  resolveMeta: vi.fn<(name: string) => unknown>(),
  openOnStartViews: vi.fn<() => { name: string; dock: string }[]>(),
  allViewNames: vi.fn<() => string[]>(),
  unregister: vi.fn<(name: string) => void>(),
  register: vi.fn<(data: { meta: unknown }) => void>(),
  selectInFlight: vi.fn<(view: string) => Promise<unknown> | undefined>(),
};

vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  config,
  datastore,
  editor,
  events,
  space,
  system,
}));
vi.mock("./ui/slots.ts", () => slots);
vi.mock("../lib/mobile.ts", () => mobile);
vi.mock("./registry.ts", () => registry);

// Resets modules so visibleSidebarView etc. start empty, like a freshly booted client.
async function freshNavigator() {
  vi.resetModules();
  return await import("./navigator.ts");
}

beforeEach(() => {
  vi.clearAllMocks();
  mobile.isNarrowScreen.mockReturnValue(false);
  slots.focusedSlot.mockReturnValue(undefined);
  registry.resolveMeta.mockReturnValue({ dock: "lhs", refreshOn: [] });
  registry.openOnStartViews.mockReturnValue([]);
  registry.allViewNames.mockReturnValue([]);
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

test("a pick whose view never opens resolves nil", async () => {
  const nav = await freshNavigator();
  registry.resolveMeta.mockReturnValue(undefined);

  expect(await nav.pickOpen("__pick:A", { dock: "modal" }, {})).toBeNull();
  expect(slots.showSlot).not.toHaveBeenCalled();
  expect(registry.unregister).toHaveBeenCalledWith("__pick:A");
});

test("resize re-shows the dock at the dragged width, and a commit persists it", async () => {
  const nav = await freshNavigator();
  await nav.open("std.spaceTree");
  slots.showSlot.mockClear();

  await nav.resize({ slot: "lhs", width: 300 });
  expect(slots.showSlot).toHaveBeenCalledWith(
    "lhs",
    "0 0 300px",
    expect.objectContaining({ view: "std.spaceTree" }),
  );
  expect(datastore.set).not.toHaveBeenCalledWith(
    ["navigator", "std.spaceTree", "width"],
    300,
  );

  await nav.resize({ slot: "lhs", width: 321, commit: true });
  expect(datastore.set).toHaveBeenCalledWith(
    ["navigator", "std.spaceTree", "width"],
    321,
  );
});

test("a stray resize with nothing docked in the slot is dropped", async () => {
  const nav = await freshNavigator();

  await nav.resize({ slot: "lhs", width: 300 });

  expect(slots.showSlot).not.toHaveBeenCalled();
});

test("a resize tick after a real close stays dropped", async () => {
  const nav = await freshNavigator();
  await nav.open("std.spaceTree");
  await nav.hide("lhs");
  slots.showSlot.mockClear();

  await nav.resize({ slot: "lhs", width: 300 });

  expect(slots.showSlot).not.toHaveBeenCalled();
});

async function registeredCommands(revisionsEnabled = true) {
  await freshNavigator();
  const { registerNavigatorCommands } = await import("./commands.ts");
  const commands = new Map<string, any>();
  registerNavigatorCommands(
    {
      registerCommand: (command: any) => commands.set(command.name, command),
    } as any,
    revisionsEnabled,
  );
  return commands;
}

test.each([
  ["Navigate: Tree", "std.spaceTree"],
  ["Revision: Page History", "std.pageHistory"],
  ["Revision: Space History", "std.spaceLog"],
])("%s opens %s and returns false, keeping the panel focused", async (command, view) => {
  const commands = await registeredCommands();

  expect(await commands.get(command).run()).toBe(false);
  expect(slots.showSlot).toHaveBeenCalled();
  // Pins the view: any of these wrappers would return false and call
  // showPanel, so those two alone don't prove which view was opened.
  expect(registry.resolveMeta).toHaveBeenCalledWith(view);
});

test("the revision commands are absent when revisions are disabled", async () => {
  const commands = await registeredCommands(false);

  expect(commands.has("Revision: Page History")).toBe(false);
  expect(commands.has("Revision: Space History")).toBe(false);
  expect(commands.has("Revision: Create snapshot")).toBe(false);
  // Unaffected by the flag.
  expect(commands.has("Navigate: Tree")).toBe(true);
});

test("Revision: Create snapshot commits now and refreshes the open views", async () => {
  space.createRevisionSnapshot.mockResolvedValue(true);
  const commands = await registeredCommands();

  await commands.get("Revision: Create snapshot").run();

  expect(space.createRevisionSnapshot).toHaveBeenCalled();
  expect(editor.flashNotification).toHaveBeenCalledWith("Snapshot created");
  expect(events.dispatchEvent).toHaveBeenCalledWith("revisions:snapshot", {});
});

test("Revision: Create snapshot says so when there was nothing to commit", async () => {
  space.createRevisionSnapshot.mockResolvedValue(false);
  const commands = await registeredCommands();

  await commands.get("Revision: Create snapshot").run();

  expect(editor.flashNotification).toHaveBeenCalledWith("Nothing to snapshot");
});

// An unmanaged space (or one whose sync remote doesn't manage revisions) is
// only knowable from the server's answer, so the command exists there too and
// has to surface the refusal rather than silently doing nothing.
test("Revision: Create snapshot surfaces a server refusal as an error", async () => {
  space.createRevisionSnapshot.mockRejectedValue(
    new Error("Revisions are not managed for this space"),
  );
  const commands = await registeredCommands();

  await commands.get("Revision: Create snapshot").run();

  expect(editor.flashNotification).toHaveBeenCalledWith(
    "Revisions are not managed for this space",
    "error",
  );
  expect(events.dispatchEvent).not.toHaveBeenCalled();
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

// The one link nothing else exercises: a Space Lua `view.define`'s `menu`
// table has to survive Lua-to-JS conversion intact (as a plain object with
// the right keys, not a Lua table wrapper) since it's what eventually
// reaches `buildAllCommands()` and, from there, the App's native-menu
// assembler (`webview-scripts/menus/assemble.ts`, which only understands
// plain `MenuContribution` objects).
test("defineView mirrors a Lua `menu` table into the command's config entry intact", async () => {
  const nav = await freshNavigator();
  const { LuaEnv, LuaStackFrame } = await import("../space_lua/runtime.ts");
  const { luaBuildStandardEnv } = await import("../space_lua/stdlib.ts");
  const { parseBlock } = await import("../space_lua/parse.ts");
  const { evalExpression } = await import("../space_lua/eval.ts");
  const env = new LuaEnv(luaBuildStandardEnv());
  const node: any = parseBlock(
    `e({ name = "space.v", command = "Space: V",
         menu = { location = "view", group = "1_views", order = 1, label = "V" },
         source = function() return {} end, onSelect = function() end })`,
  ).statements[0];
  const spec = evalExpression(
    node.call.args[0],
    env,
    new LuaStackFrame(env, node.ctx),
  );

  await nav.defineView(spec);

  const [path, command] = config.set.mock.calls[0];
  expect(path).toEqual(["commands", "Space: V"]);
  expect(Object.keys(command as object).sort()).toEqual([
    "menu",
    "name",
    "run",
  ]);
  // Plain JS object, not a LuaTable -- this is exactly the shape
  // `MenuContribution` expects on the App side.
  expect((command as any).menu).toEqual({
    location: "view",
    group: "1_views",
    order: 1,
    label: "V",
  });
});

test("openView refuses to open a pick view by name", async () => {
  const nav = await freshNavigator();

  expect(() => nav.openView("__pick:1:0.5")).toThrow(
    "view.open: '__pick:1:0.5' is a view.pick view",
  );
  expect(() => nav.openView("space.v", "modal")).toThrow(
    "view.open: opts must be a table",
  );
});

test("moveDock persists the dock and reopens a visible window view there", async () => {
  const nav = await freshNavigator();
  registry.resolveMeta.mockReturnValue({
    name: "v",
    title: "V",
    dock: "rhs",
    supportedDocks: ["rhs", "lhs", "modal"],
    refreshOn: [],
  });
  // datastore is a bare mock (no real storage), so mirror the dock key's
  // persisted value off `datastore.set`'s own call history -- this is what
  // lets the post-move `open()` resolve to the dock just persisted.
  datastore.get.mockImplementation((key: unknown[]) => {
    const match = datastore.set.mock.calls.findLast(
      ([k]) => JSON.stringify(k) === JSON.stringify(key),
    );
    return Promise.resolve(match?.[1]);
  });

  await nav.open("v");
  slots.showSlot.mockClear();

  await nav.moveDock("v", "lhs");

  expect(datastore.set).toHaveBeenCalledWith(["navigator", "v", "dock"], "lhs");
  expect(slots.hideSlot).toHaveBeenCalledWith("rhs");
  expect(slots.showSlot).toHaveBeenCalledWith(
    "lhs",
    expect.anything(),
    expect.objectContaining({ view: "v" }),
    false,
  );
});

// Round 2 (a): the modal used to linger on screen after picking a dock from
// its own dock menu -- `isWindowDock("modal")` is false, so the old guard
// never hid it. `moveDock` now hides `before` on modal too, not just lhs/rhs.
test("moveDock hides the modal slot (not just a window dock) when moving a view out of it", async () => {
  const nav = await freshNavigator();
  registry.resolveMeta.mockReturnValue({
    name: "v",
    title: "V",
    dock: "modal",
    supportedDocks: ["modal", "lhs", "rhs"],
    refreshOn: [],
  });
  datastore.get.mockImplementation((key: unknown[]) => {
    const match = datastore.set.mock.calls.findLast(
      ([k]) => JSON.stringify(k) === JSON.stringify(key),
    );
    return Promise.resolve(match?.[1]);
  });

  await nav.open("v");
  slots.showSlot.mockClear();

  await nav.moveDock("v", "lhs");

  expect(datastore.set).toHaveBeenCalledWith(["navigator", "v", "dock"], "lhs");
  expect(slots.hideSlot).toHaveBeenCalledWith("modal");
  expect(slots.showSlot).toHaveBeenCalledWith(
    "lhs",
    expect.anything(),
    expect.objectContaining({ view: "v" }),
    false,
  );
});

// The sidebar hide writes `open = false` on its way out; the page-dock move
// writes `true` after it. Reordering those two lines leaves a moved view
// stored closed, and its widget never renders.
test("moveDock from a sidebar to a page dock leaves the view stored open", async () => {
  const nav = await freshNavigator();
  const previousClient = (globalThis as any).client;
  (globalThis as any).client = { rebuildEditorState: vi.fn() };
  registry.resolveMeta.mockReturnValue({
    name: "v",
    title: "V",
    dock: "lhs",
    supportedDocks: ["lhs", "page-top"],
    refreshOn: [],
  });
  datastore.get.mockImplementation((key: unknown[]) => {
    const match = datastore.set.mock.calls.findLast(
      ([k]) => JSON.stringify(k) === JSON.stringify(key),
    );
    return Promise.resolve(match?.[1]);
  });

  try {
    await nav.open("v");
    await nav.moveDock("v", "page-top");
    expect(await datastore.get(["navigator", "v", "open"])).toBe(true);
  } finally {
    (globalThis as any).client = previousClient;
  }
});

test("closeView hides the slot without touching the dock preference", async () => {
  const nav = await freshNavigator();
  registry.resolveMeta.mockReturnValue({
    name: "w",
    title: "W",
    dock: "rhs",
    refreshOn: [],
  });

  await nav.open("w");
  datastore.set.mockClear();

  await nav.closeView("w", "rhs");

  expect(slots.hideSlot).toHaveBeenCalledWith("rhs");
  expect(datastore.set).not.toHaveBeenCalledWith(
    ["navigator", "w", "dock"],
    expect.anything(),
  );
});

test("setViewDefaults feeds dock resolution and is replaced wholesale", async () => {
  const nav = await freshNavigator();
  registry.resolveMeta.mockReturnValue({
    dock: "modal",
    supportedDocks: ["modal", "rhs"],
    refreshOn: [],
  });
  datastore.get.mockResolvedValue(undefined);

  expect(await nav.resolvedDock("t.view")).toBe("modal");
  nav.setViewDefaults({ "t.view": { dock: "rhs" } });
  expect(await nav.resolvedDock("t.view")).toBe("rhs");
  nav.setViewDefaults({});
  expect(await nav.resolvedDock("t.view")).toBe("modal");
});

test("only views the space configured open reach boot restore", async () => {
  const nav = await freshNavigator();
  registry.allViewNames.mockReturnValue(["a", "b", "c"]);
  registry.resolveMeta.mockReturnValue({ dock: "lhs", refreshOn: [] });
  datastore.get.mockResolvedValue(undefined);

  nav.setViewDefaults({
    a: { open: true },
    b: { open: false },
    c: { width: 300 },
  });
  await nav.restoreDocks();

  const shown = slots.showSlot.mock.calls.map((call: any[]) => call[2].view);
  expect(shown).toEqual(["a"]);
});
