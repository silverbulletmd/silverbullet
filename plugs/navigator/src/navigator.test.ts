import { beforeEach, expect, test, vi } from "vitest";

/**
 * `resize()`'s guard (item D, feedback round 2): `visibleSidebarView` is
 * module-level plug-worker state, while the panel iframe it describes lives
 * on the host side. Anything that recycles the plug worker without also
 * rebuilding the panel wipes the map while the dock stays visibly open --
 * simulated here with `vi.resetModules()` + a fresh dynamic import, which
 * re-runs navigator.ts's top-level module code exactly like a fresh worker
 * instantiation would.
 */

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

vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  asset,
  datastore,
  editor,
  events,
}));
vi.mock("@silverbulletmd/silverbullet/ui", () => ({
  panelStyles: vi.fn<() => Promise<string>>().mockResolvedValue(""),
}));
// Only referenced from builtins.ts, which resize()'s path doesn't reach.
vi.mock("./builtins.ts", () => ({ builtinMeta: vi.fn() }));

/** A fresh module instance -- empty `visibleSidebarView` etc., like a
 * just-restarted plug worker. */
async function freshNavigator() {
  vi.resetModules();
  return await import("./navigator.ts");
}

beforeEach(() => {
  vi.clearAllMocks();
  asset.readAsset.mockResolvedValue("");
  editor.isNarrowScreen.mockResolvedValue(false);
  events.dispatchEvent.mockResolvedValue([{ dock: "lhs", refreshOn: [] }]);
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
  await nav.panelHidden({ slot: "lhs" }); // real close: clears the map and the datastore key
  datastore.get.mockResolvedValue(undefined); // reflects panelHidden's datastore.del
  editor.showPanel.mockClear();

  await nav.resize({ slot: "lhs", width: 300 });

  expect(editor.showPanel).not.toHaveBeenCalled();
});

// D-1 (feedback round 2, fix round 1): before this fix, `resize()` re-seeded
// `visibleSidebarView` after a wipe but never `slotEvents`, so every
// post-wipe drag tick fell through to `eventsForView`, dispatching
// `navigator:meta` (a Space Lua syscall) on every rAF frame for as long as
// the worker stayed wiped -- the syscall storm the brief forbade.
test("only the first post-wipe tick dispatches navigator:meta; later ticks don't", async () => {
  const nav = await freshNavigator();
  datastore.get.mockResolvedValue("std.spaceTree");

  await nav.resize({ slot: "lhs", width: 300 });
  const metaDispatches = () =>
    events.dispatchEvent.mock.calls.filter(([name]) => name === "navigator:meta");
  expect(metaDispatches()).toHaveLength(1);

  events.dispatchEvent.mockClear();
  await nav.resize({ slot: "lhs", width: 305 });
  await nav.resize({ slot: "lhs", width: 310 });
  expect(metaDispatches()).toHaveLength(0);
});

// D-3(a) (feedback round 2, fix round 1): `panelHidden` deletes the map entry
// and then awaits `datastore.del`. A resize tick landing in that window must
// not re-derive the still-present datastore key and re-show (and re-arm) the
// panel that is actually closing. This exercises `resize()`'s *first*
// `closingSlots` check (navigator.ts, entry to the re-derivation branch,
// before any of its own awaits): `panelHidden` is invoked and its
// synchronous prefix (map delete + `closingSlots.add`) has already run to
// completion before `resize()` is even called, since JS runs synchronously up
// to the first `await` and nothing here awaits `panelHidden` first.
test("a resize tick that starts after panelHidden has already marked the slot closing is dropped (first check)", async () => {
  const nav = await freshNavigator();
  datastore.get.mockResolvedValue("std.spaceTree");
  await nav.open("std.spaceTree");

  let resolveDel!: () => void;
  datastore.del.mockImplementation(
    () => new Promise<void>((resolve) => (resolveDel = resolve)),
  );
  const hiddenPromise = nav.panelHidden({ slot: "lhs" });

  // The key panelHidden is about to delete is (realistically) still readable
  // as present while its own datastore.del is in flight.
  datastore.get.mockResolvedValue("std.spaceTree");
  editor.showPanel.mockClear();

  await nav.resize({ slot: "lhs", width: 300 });
  expect(editor.showPanel).not.toHaveBeenCalled();

  resolveDel();
  await hiddenPromise;

  // Nor does a later tick resurrect it once the close has fully landed.
  datastore.get.mockResolvedValue(undefined);
  await nav.resize({ slot: "lhs", width: 305 });
  expect(editor.showPanel).not.toHaveBeenCalled();
});

// D-3(a), fix round 2: the narrower interleaving the *second* `closingSlots`
// check exists for -- a close that starts and marks the slot *while
// `resize()`'s own awaits (`datastore.get`, then `viewMeta`) are already in
// flight*, rather than before `resize()` is even called. `resize()` starts
// first here (with no `view` in the payload, forcing it through the
// datastore-fallback path so it has an await for `panelHidden` to interleave
// into); `panelHidden` starts next, marking `closingSlots` and then itself
// stalling on `datastore.del`. Both of `resize()`'s own awaits are allowed to
// resolve while the slot is still marked closing, so by the time it reaches
// the check right before committing the derived name into
// `visibleSidebarView` (after `datastore.get` *and* `viewMeta`), the mark is
// exactly what makes it bail -- the first check (taken before either await)
// would have passed clean, since `panelHidden` hadn't started yet at that
// point.
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
  // Starts, and marks `closingSlots`, while resize's `datastore.get` is still
  // pending -- resize has already taken its first (clean) check by now.
  const hiddenPromise = nav.panelHidden({ slot: "lhs" });

  // Let resize's datastore.get resolve with a real view name; panelHidden's
  // own datastore.del stays deliberately unresolved, so closingSlots is still
  // marked when resize reaches viewMeta and, after that, its second check.
  resolveGet("std.spaceTree");
  await resizePromise;
  expect(editor.showPanel).not.toHaveBeenCalled();

  resolveDel();
  await hiddenPromise;
});

// D-3(b) (feedback round 2, fix round 1): route() hops are deliberately not
// persisted to the datastore, so after a wipe the datastore alone would
// re-derive the pre-hop view. The panel's own reported `view` (from its live
// React state, sent in the resize payload) is authoritative instead.
test("resize after a wipe trusts the panel's reported view over a stale (pre-hop) datastore entry", async () => {
  const nav = await freshNavigator();
  // The datastore still remembers the pre-hop view -- route() never writes
  // dockedKey -- but the panel reports it is actually showing the routed-to
  // view.
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
  expect(events.dispatchEvent).toHaveBeenCalledWith("navigator:meta", {
    name: "std.toc",
  });
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
  expect(events.dispatchEvent).toHaveBeenCalledWith("navigator:meta", {
    name: "std.spaceTree",
  });
  expect(datastore.set).toHaveBeenCalledWith(
    ["navigator", "docked", "lhs"],
    "std.spaceTree",
  );
});
