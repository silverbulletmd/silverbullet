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
const asset = {
  readAsset: vi.fn<(plug: string, path: string) => Promise<string>>(),
};

const registry = {
  resolveMeta: vi.fn<(name: string) => unknown>(),
  openOnStartViews: vi.fn<() => { name: string; dock: string }[]>(),
  unregister: vi.fn<(name: string) => void>(),
  register: vi.fn<(data: { meta: unknown }) => void>(),
  selectInFlight: vi.fn<(view: string) => Promise<unknown> | undefined>(),
};

vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  asset,
  datastore,
  editor,
  events,
}));
vi.mock("@silverbulletmd/silverbullet/lib/panel_styles", () => ({
  panelStyles: vi.fn<() => Promise<string>>().mockResolvedValue(""),
}));
vi.mock("./registry.ts", () => registry);

// Resets modules so visibleSidebarView etc. start empty, like a freshly restarted plug worker.
async function freshNavigator() {
  vi.resetModules();
  return await import("./navigator.ts");
}

beforeEach(() => {
  vi.clearAllMocks();
  asset.readAsset.mockResolvedValue("");
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
    .pickOpen("__pick:A", { dock: "modal" })
    .then((v: unknown) => {
      firstSettled = true;
      return v;
    });
  nav.pickOpen("__pick:B", { dock: "modal" });

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

test("a new pick opening in the same slot with no in-flight select for the previous one nulls it immediately", async () => {
  const nav = await freshNavigator();
  registry.resolveMeta.mockReturnValue({ dock: "modal", refreshOn: [] });
  registry.selectInFlight.mockReturnValue(undefined);

  const first = nav.pickOpen("__pick:A", { dock: "modal" });
  nav.pickOpen("__pick:B", { dock: "modal" });

  expect(await first).toBeNull();
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

test("openToc opens std.toc and returns false, keeping the panel focused", async () => {
  const nav = await freshNavigator();

  expect(await nav.openToc()).toBe(false);
  expect(editor.showPanel).toHaveBeenCalled();
  // Pins the view: a wrapper that opened any other view would still return
  // false and call showPanel, so those two alone don't prove which view.
  expect(registry.resolveMeta).toHaveBeenCalledWith("std.toc");
  expect(datastore.set).toHaveBeenCalledWith(
    ["navigator", "docked", "lhs"],
    "std.toc",
  );
});

test("openSpaceTree opens std.spaceTree and returns false, keeping the panel focused", async () => {
  const nav = await freshNavigator();

  expect(await nav.openSpaceTree()).toBe(false);
  expect(editor.showPanel).toHaveBeenCalled();
  // Pins the view: passes verbatim if openSpaceTree were openCommand("std.toc")
  // without this, since both return false and both call showPanel.
  expect(registry.resolveMeta).toHaveBeenCalledWith("std.spaceTree");
  expect(datastore.set).toHaveBeenCalledWith(
    ["navigator", "docked", "lhs"],
    "std.spaceTree",
  );
});
