import { beforeEach, expect, test, vi } from "vitest";

/**
 * `resize()`'s guard: `visibleSidebarView` is
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
// The registry is its own unit (registry.test.ts); resize()'s path only
// needs a stand-in that answers `dock`/`refreshOn` the same way.
vi.mock("./registry.ts", () => registry);

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

// a newer activation superseding a still-pending pick must
// not null it out from under a row the user already clicked -- `select`'s
// answer, still crossing the bridge, has to land first.
//
// a fixed count of microtask ticks here was vacuous -- `show()`
// has several `await`s (`panelContent`, `showPanel`, `navigator:activate`)
// between B's `pickOpen` call and the point where its supersede step actually
// runs, so "not settled after two ticks" held whether or not the guard did
// anything (confirmed by temporarily neutering `supersede` to a bare
// `settlePick(name, null)` and re-running this test: it still passed).
// Waiting for the guard's own consult of `selectInFlight("__pick:A")` --
// the actual decision point -- instead of a tick count makes the test fail
// under that same neutering (it never calls `selectInFlight` at all, so the
// wait below times out) and pass with the real guard restored.
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
  // B's own pick never settles in this test -- only its supersede of A does.
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
  await nav.panelHidden({ slot: "lhs" }); // real close: clears the map and the datastore key
  datastore.get.mockResolvedValue(undefined); // reflects panelHidden's datastore.del
  editor.showPanel.mockClear();

  await nav.resize({ slot: "lhs", width: 300 });

  expect(editor.showPanel).not.toHaveBeenCalled();
});

// `resize()` re-seeded
// `visibleSidebarView` after a wipe but never `slotEvents`, so every
// post-wipe drag tick fell through to `eventsForView`, re-resolving meta on
// every rAF frame for as long as the worker stayed wiped -- the resolution
// storm the brief forbade. `resolveMeta` is a plain map lookup now rather
// than a Space Lua dispatch, but the same one-tick-only guard still applies.
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

// `panelHidden` deletes the map entry
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

// the narrower interleaving the *second* `closingSlots`
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

// route() hops are deliberately not
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
