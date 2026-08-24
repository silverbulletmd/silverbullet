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
  ["Navigate: Outline", "std.toc"],
  ["Navigate: Outline Picker", "std.tocModal"],
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

test("openView refuses to open a pick view by name", async () => {
  const nav = await freshNavigator();

  expect(() => nav.openView("__pick:1:0.5")).toThrow(
    "navigator.open: '__pick:1:0.5' is a navigator.pick view",
  );
  expect(() => nav.openView("space.v", "modal")).toThrow(
    "navigator.open: opts must be a table",
  );
});
