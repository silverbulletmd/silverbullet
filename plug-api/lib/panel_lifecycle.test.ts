import { beforeEach, expect, test, vi } from "vitest";

/**
 * The generic panel-slot lifecycle extracted from the navigator (see
 * `client/navigator/navigator.ts` for the reference consumer, and its own
 * `navigator.test.ts` for the content-specific pinning of these same
 * behaviors through navigator's wrappers). These tests exercise
 * `createPanelLifecycle` directly, against a minimal fake `config`, so the
 * module stays testable independent of any one consumer's own Lua/pick
 * machinery.
 */

const datastore = {
  get: vi.fn<(key: unknown[]) => Promise<unknown>>(),
  set: vi.fn<(key: unknown[], value: unknown) => Promise<void>>(),
  del: vi.fn<(key: unknown[]) => Promise<void>>(),
};
const editor = {
  showPanel: vi.fn<(...args: unknown[]) => Promise<void>>(),
  hidePanel: vi.fn<(...args: unknown[]) => Promise<void>>(),
  focus: vi.fn<() => Promise<void>>(),
  getFocusedPanelSlot: vi.fn<() => Promise<string | undefined>>(),
  flashNotification: vi.fn<(msg: string, kind?: string) => Promise<void>>(),
  isNarrowScreen: vi.fn<() => Promise<boolean>>(),
};
const events = {
  dispatchEvent: vi.fn<(name: string, data?: unknown) => Promise<unknown[]>>(),
};

vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  datastore,
  editor,
  events,
}));

const { createPanelLifecycle } = await import("./panel_lifecycle.ts");
type Meta = { dock: string; refreshOn?: string[] };

function makeConfig(
  overrides: Partial<Parameters<typeof createPanelLifecycle>[0]> = {},
) {
  const build = vi.fn(async (slot: string, preamble: string) => ({
    html: `${preamble}<html:${slot}>`,
    script: `<script:${slot}>`,
  }));
  const preamble = vi.fn(async () => "");
  const getMeta = vi.fn<(name: string) => Meta | undefined>();
  const buildEvents = vi.fn((refreshOn?: string[]) => refreshOn ?? []);
  const onSuperseded = vi.fn();
  const onSlotClosedWithoutSuccessor = vi.fn();
  const getForcedOpens = vi.fn<() => { name: string; dock: string }[]>(
    () => [],
  );
  const config = {
    namespace: "test",
    widthBounds: { min: 100, max: 500, default: 200 },
    modalMode: 100,
    notFoundLabel: "test view",
    getMeta,
    buildEvents,
    content: { preamble, build },
    getForcedOpens,
    onSuperseded,
    onSlotClosedWithoutSuccessor,
    ...overrides,
  };
  return {
    config,
    getMeta,
    buildEvents,
    preamble,
    build,
    onSuperseded,
    onSlotClosedWithoutSuccessor,
    getForcedOpens,
  };
}

beforeEach(() => {
  // `resetAllMocks`, not `clearAllMocks`: a few tests below install a
  // never-resolving `mockImplementation` on `datastore.del`/`.get` to probe
  // an interleaving window, and that implementation must not leak into the
  // next test (it would hang it forever awaiting a promise nothing resolves).
  vi.resetAllMocks();
  editor.isNarrowScreen.mockResolvedValue(false);
  editor.getFocusedPanelSlot.mockResolvedValue(undefined);
});

test("ready echoes the pending activation for a slot, undefined otherwise", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  expect(lc.ready({ slot: "lhs" })).toBeUndefined();
  await lc.open("a");
  const activation = lc.ready({ slot: "lhs" });
  expect(activation?.view).toBe("a");
  expect(typeof activation?.token).toBe("number");
});

test("open on an unknown view flashes a notification naming the caller's notFoundLabel and returns false", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue(undefined);
  const lc = createPanelLifecycle(config);

  expect(await lc.open("nope")).toBe(false);
  expect(editor.flashNotification).toHaveBeenCalledWith(
    "No test view named nope",
    "error",
  );
});

test("open on an unknown view with quiet:true suppresses the notification", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue(undefined);
  const lc = createPanelLifecycle(config);

  expect(await lc.open("nope", { quiet: true })).toBe(false);
  expect(editor.flashNotification).not.toHaveBeenCalled();
});

test("open echoes extra opts fields (minus quiet) onto the activation and the dispatched event", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.open("a", { quiet: true, phrase: "hello", segment: "s1" });

  const activation = lc.ready({ slot: "lhs" });
  expect(activation).toMatchObject({
    view: "a",
    phrase: "hello",
    segment: "s1",
  });
  expect(activation).not.toHaveProperty("quiet");
  expect(events.dispatchEvent).toHaveBeenCalledWith(
    "test:activate",
    expect.objectContaining({
      slot: "lhs",
      view: "a",
      phrase: "hello",
      segment: "s1",
    }),
  );
});

test("open on an already-focused sidebar slot toggles it closed instead of re-opening", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  editor.getFocusedPanelSlot.mockResolvedValue("lhs");
  editor.showPanel.mockClear();

  expect(await lc.open("a")).toBe(true);
  expect(editor.hidePanel).toHaveBeenCalledWith("lhs");
  expect(editor.focus).toHaveBeenCalled();
  expect(editor.showPanel).not.toHaveBeenCalled();
});

test("restoreDocks' passive restore never takes the toggle-closed branch, even if the slot reports focused", async () => {
  // Falsifiability: without the `!passive` guard, a boot restore landing on
  // a slot the editor reports as focused would hide the panel it's meant to
  // bring back instead of showing it.
  const { config, getMeta } = makeConfig({ sidebarSlots: ["lhs"] } as any);
  datastore.get.mockResolvedValue("a");
  getMeta.mockReturnValue({ dock: "lhs" });
  editor.getFocusedPanelSlot.mockResolvedValue("lhs");
  const lc = createPanelLifecycle(config);

  await lc.restoreDocks();

  expect(editor.hidePanel).not.toHaveBeenCalled();
  expect(editor.showPanel).toHaveBeenCalled();
});

test("a newer open() supersedes the previous occupant of the same slot after the activate dispatch", async () => {
  const { config, getMeta, onSuperseded } = makeConfig();
  getMeta.mockReturnValue({ dock: "modal" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  expect(onSuperseded).not.toHaveBeenCalled();

  const callOrder: string[] = [];
  events.dispatchEvent.mockImplementation(async (name: string) => {
    callOrder.push(`dispatch:${name}`);
    return [];
  });
  onSuperseded.mockImplementation(() => callOrder.push("superseded"));

  await lc.open("b");
  expect(onSuperseded).toHaveBeenCalledWith("a");
  // Pins the ordering the navigator round explicitly preserved: supersede
  // fires only after the success-path activate dispatch has gone out, not
  // before it (a plain trailing call after `pendingActivation.set` would
  // fire too early).
  expect(callOrder).toEqual(["dispatch:test:activate", "superseded"]);
});

test("a throw mid-activation still supersedes the previous occupant (finally, not a trailing call)", async () => {
  // Falsifiability: replacing the `finally` with a plain call after the
  // dispatch would leave `onSuperseded` uncalled here, since
  // `editor.showPanel` rejects before that line is ever reached.
  const { config, getMeta, onSuperseded } = makeConfig();
  getMeta.mockReturnValue({ dock: "modal" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  editor.showPanel.mockRejectedValueOnce(new Error("boom"));

  await expect(lc.open("b")).rejects.toThrow("boom");
  expect(onSuperseded).toHaveBeenCalledWith("a");
});

test("open() does not supersede when re-opening the same view already occupying the slot", async () => {
  const { config, getMeta, onSuperseded } = makeConfig();
  getMeta.mockReturnValue({ dock: "modal" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  await lc.open("a");
  expect(onSuperseded).not.toHaveBeenCalled();
});

test("panelHidden fires onSlotClosedWithoutSuccessor only when the token matches the current activation", async () => {
  const { config, getMeta, onSlotClosedWithoutSuccessor } = makeConfig();
  getMeta.mockReturnValue({ dock: "modal" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  const staleToken = lc.ready({ slot: "modal" })!.token;
  await lc.open("b"); // b now occupies "modal" with a newer token

  // Falsifiability: without the token check, this stale close (naming a's
  // now-superseded token) would settle *b* -- the pick the user hasn't
  // acted on yet -- with nil.
  await lc.panelHidden({ slot: "modal", token: staleToken });
  expect(onSlotClosedWithoutSuccessor).not.toHaveBeenCalled();

  const freshToken = lc.ready({ slot: "modal" })!.token;
  await lc.panelHidden({ slot: "modal", token: freshToken });
  expect(onSlotClosedWithoutSuccessor).toHaveBeenCalledWith("b");
});

test("panelHidden with no token never fires the hook", async () => {
  const { config, getMeta, onSlotClosedWithoutSuccessor } = makeConfig();
  getMeta.mockReturnValue({ dock: "modal" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  await lc.panelHidden({ slot: "modal" });
  expect(onSlotClosedWithoutSuccessor).not.toHaveBeenCalled();
});

test("panelHidden un-remembers a sidebar dock (datastore.del) but never touches the modal slot's dockedKey", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  await lc.panelHidden({ slot: "lhs" });
  expect(datastore.del).toHaveBeenCalledWith(["test", "docked", "lhs"]);

  datastore.del.mockClear();
  getMeta.mockReturnValue({ dock: "modal" });
  await lc.open("b");
  await lc.panelHidden({ slot: "modal" });
  expect(datastore.del).not.toHaveBeenCalled();
});

test("replaceInSlot never persists to dockedKey, unlike open", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.replaceInSlot("lhs", "a", {});
  expect(datastore.set).not.toHaveBeenCalledWith(
    ["test", "docked", "lhs"],
    expect.anything(),
  );
});

test("replaceInSlot reuses the slot's current width mode rather than the target's own saved width", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.open("a"); // no saved width -> default 200 -> "0 0 200px"
  await lc.resize({ slot: "lhs", width: 321, commit: true, view: "a" });
  editor.showPanel.mockClear();

  await lc.replaceInSlot("lhs", "b", {});
  expect(editor.showPanel).toHaveBeenCalledWith(
    "lhs",
    "0 0 321px",
    expect.any(String),
    expect.any(String),
    expect.any(Object),
  );
  expect(datastore.get).not.toHaveBeenCalledWith(["test", "b", "width"]);
});

test("replaceInSlot also supersedes the previous occupant", async () => {
  const { config, getMeta, onSuperseded } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  await lc.replaceInSlot("lhs", "b", {});
  expect(onSuperseded).toHaveBeenCalledWith("a");
});

test("resize re-derives the docked view from the datastore when in-memory state is empty", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  datastore.get.mockResolvedValue("a");
  const lc = createPanelLifecycle(config);

  await lc.resize({ slot: "lhs", width: 300 });

  expect(editor.showPanel).toHaveBeenCalledWith(
    "lhs",
    "0 0 300px",
    expect.any(String),
    expect.any(String),
    expect.objectContaining({ key: "test:lhs" }),
  );
});

test("a stray resize with nothing docked in the slot (datastore agrees) is dropped", async () => {
  const { config } = makeConfig();
  datastore.get.mockResolvedValue(undefined);
  const lc = createPanelLifecycle(config);

  await lc.resize({ slot: "lhs", width: 300 });
  expect(editor.showPanel).not.toHaveBeenCalled();
});

test("only the first post-wipe tick pays for the datastore read and re-resolves meta", async () => {
  // Falsifiability: dropping the `visibleSidebarView.set`/`slotEvents.set`
  // re-seed after a wipe would make every subsequent tick fall through to
  // the datastore/meta re-derivation again, one syscall per drag frame.
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  datastore.get.mockResolvedValue("a");
  const lc = createPanelLifecycle(config);

  await lc.resize({ slot: "lhs", width: 300 });
  expect(datastore.get).toHaveBeenCalledTimes(1);
  expect(getMeta).toHaveBeenCalledTimes(1);

  getMeta.mockClear();
  await lc.resize({ slot: "lhs", width: 320 });
  expect(datastore.get).toHaveBeenCalledTimes(1);
  expect(getMeta).not.toHaveBeenCalled();
  expect(editor.showPanel).toHaveBeenLastCalledWith(
    "lhs",
    "0 0 320px",
    expect.any(String),
    expect.any(String),
    expect.any(Object),
  );
});

test("a resize tick that starts after panelHidden has already marked the slot closing is dropped (first check)", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  datastore.get.mockResolvedValue("a");
  const lc = createPanelLifecycle(config);
  await lc.open("a");

  let resolveDel!: () => void;
  datastore.del.mockImplementation(
    () => new Promise<void>((resolve) => (resolveDel = resolve)),
  );
  const hiddenPromise = lc.panelHidden({ slot: "lhs" });

  datastore.get.mockResolvedValue("a");
  editor.showPanel.mockClear();

  await lc.resize({ slot: "lhs", width: 300 });
  expect(editor.showPanel).not.toHaveBeenCalled();

  resolveDel();
  await hiddenPromise;

  datastore.get.mockResolvedValue(undefined);
  await lc.resize({ slot: "lhs", width: 305 });
  expect(editor.showPanel).not.toHaveBeenCalled();
});

test("a resize tick whose own awaits are interleaved by a mid-flight close is dropped (second check)", async () => {
  const { config, getMeta } = makeConfig();
  const lc = createPanelLifecycle(config);

  let resolveGet!: (value: unknown) => void;
  datastore.get.mockImplementation(
    () => new Promise((resolve) => (resolveGet = resolve)),
  );
  let resolveDel!: () => void;
  datastore.del.mockImplementation(
    () => new Promise<void>((resolve) => (resolveDel = resolve)),
  );
  getMeta.mockReturnValue({ dock: "lhs" });

  const resizePromise = lc.resize({ slot: "lhs", width: 300 });
  const hiddenPromise = lc.panelHidden({ slot: "lhs" });

  resolveGet("a");
  await resizePromise;
  expect(editor.showPanel).not.toHaveBeenCalled();

  resolveDel();
  await hiddenPromise;
});

test("resize after a wipe trusts the payload's view over a stale datastore entry", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  datastore.get.mockResolvedValue("a");
  const lc = createPanelLifecycle(config);

  await lc.resize({ slot: "lhs", width: 321, view: "b" });

  expect(datastore.get).not.toHaveBeenCalled();
  expect(editor.showPanel).toHaveBeenCalledWith(
    "lhs",
    "0 0 321px",
    expect.any(String),
    expect.any(String),
    expect.any(Object),
  );

  await lc.resize({ slot: "lhs", width: 321, commit: true, view: "b" });
  expect(datastore.set).toHaveBeenCalledWith(["test", "b", "width"], 321);
});

test("restoreDocks skips entirely on a narrow screen", async () => {
  const { config, getForcedOpens } = makeConfig();
  editor.isNarrowScreen.mockResolvedValue(true);
  const lc = createPanelLifecycle(config);

  await lc.restoreDocks();
  expect(getForcedOpens).not.toHaveBeenCalled();
  expect(datastore.get).not.toHaveBeenCalled();
  expect(editor.showPanel).not.toHaveBeenCalled();
});

test("restoreDocks: a forced (openOnStart-equivalent) view beats a saved dockedKey for the same slot", async () => {
  const { config, getMeta, getForcedOpens } = makeConfig({
    sidebarSlots: ["lhs"],
  } as any);
  getForcedOpens.mockReturnValue([{ name: "forced", dock: "lhs" }]);
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.restoreDocks();

  expect(datastore.get).not.toHaveBeenCalledWith(["test", "docked", "lhs"]);
  expect(editor.showPanel).toHaveBeenCalledWith(
    "lhs",
    expect.anything(),
    expect.any(String),
    expect.any(String),
    expect.objectContaining({ key: "test:lhs" }),
  );
  expect(lc.ready({ slot: "lhs" })).toMatchObject({
    view: "forced",
    passive: true,
  });
});

test("restoreDocks: a dock mismatch between the saved slot and the view's current meta is decisive (datastore.del, no restore)", async () => {
  const { config, getMeta } = makeConfig({ sidebarSlots: ["lhs"] } as any);
  datastore.get.mockResolvedValue("moved");
  getMeta.mockReturnValue({ dock: "rhs" }); // lives elsewhere now
  const lc = createPanelLifecycle(config);

  await lc.restoreDocks();

  expect(datastore.del).toHaveBeenCalledWith(["test", "docked", "lhs"]);
  expect(editor.showPanel).not.toHaveBeenCalled();
});

test("restoreDocks: a currently-unresolvable saved name is skipped, not deleted", async () => {
  // Falsifiability: treating "not yet resolvable" the same as "gone" would
  // silently forget a dock on a cold boot before the space finishes
  // indexing, exactly the regression the navigator round's comment warns
  // about.
  const { config, getMeta } = makeConfig({ sidebarSlots: ["lhs"] } as any);
  datastore.get.mockResolvedValue("not-yet-indexed");
  getMeta.mockReturnValue(undefined);
  const lc = createPanelLifecycle(config);

  await lc.restoreDocks();

  expect(datastore.del).not.toHaveBeenCalled();
  expect(editor.showPanel).not.toHaveBeenCalled();
});

test("resize reuses the cached content identity without rebuilding, even if the preamble changed since", async () => {
  // Pins the identity contract a host's `show-keyed-panel` reducer relies on
  // to skip rebuilding the iframe on a same-content re-show: a drag tick
  // must not re-read the preamble (a syscall per rAF frame) or swap the
  // html/script identity mid-drag.
  const { config, getMeta, build, preamble } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  preamble.mockResolvedValue("<preamble-v1/>");
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  expect(build).toHaveBeenCalledTimes(1);
  const firstArgs = editor.showPanel.mock.calls[0];

  preamble.mockResolvedValue("<preamble-v2/>"); // resize must not notice
  editor.showPanel.mockClear();
  await lc.resize({ slot: "lhs", width: 250, view: "a" });

  expect(build).toHaveBeenCalledTimes(1);
  const secondArgs = editor.showPanel.mock.calls[0];
  expect(secondArgs[2]).toBe(firstArgs[2]); // html, same reference
  expect(secondArgs[3]).toBe(firstArgs[3]); // script, same reference
});

test("content cache: a changed preamble triggers a rebuild the next time the slot is (re)activated", async () => {
  const { config, getMeta, build, preamble } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  preamble.mockResolvedValue("<preamble-v1/>");
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  expect(build).toHaveBeenCalledTimes(1);

  preamble.mockResolvedValue("<preamble-v2/>");
  await lc.open("a"); // not focused in this test, so re-activates rather than toggling closed
  expect(build).toHaveBeenCalledTimes(2);
});
