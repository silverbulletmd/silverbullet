import { beforeEach, expect, test, vi } from "vitest";

/**
 * The panel-slot lifecycle behind the navigator's docks and modal (see
 * `navigator.ts` for the consumer, and its own `navigator.test.ts` for the
 * content-specific pinning of these same behaviors through navigator's
 * wrappers). These tests exercise `createPanelLifecycle` directly, against a
 * minimal fake `config` and a mocked mount surface.
 */

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

vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  datastore,
  editor,
}));
vi.mock("./ui/slots.ts", () => slots);
vi.mock("../lib/mobile.ts", () => mobile);

const { createPanelLifecycle } = await import("./panel_lifecycle.ts");
type Meta = { dock: string; supportedDocks?: string[] };

function makeConfig(
  overrides: Partial<Parameters<typeof createPanelLifecycle>[0]> = {},
) {
  const getMeta = vi.fn<(name: string) => Meta | undefined>();
  const onSuperseded = vi.fn();
  const onSlotClosedWithoutSuccessor = vi.fn();
  const getForcedOpens = vi.fn<() => { name: string; dock: string }[]>(
    () => [],
  );
  const config = {
    getMeta,
    getForcedOpens,
    onSuperseded,
    onSlotClosedWithoutSuccessor,
    ...overrides,
  };
  return {
    config,
    getMeta,
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
  mobile.isNarrowScreen.mockReturnValue(false);
  slots.focusedSlot.mockReturnValue(undefined);
});

test("current echoes the activation a slot is showing, undefined otherwise", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  expect(lc.current("lhs")).toBeUndefined();
  await lc.open("a");
  const activation = lc.current("lhs");
  expect(activation?.view).toBe("a");
  expect(typeof activation?.token).toBe("number");
});

test("open on an unknown view flashes a notification naming the view kind and returns false", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue(undefined);
  const lc = createPanelLifecycle(config);

  expect(await lc.open("nope")).toBe(false);
  expect(editor.flashNotification).toHaveBeenCalledWith(
    "No navigator view named nope",
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

test("open echoes extra opts fields (minus quiet) onto the activation the slot is shown with", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.open("a", { quiet: true, phrase: "hello", segment: "s1" });

  const activation = lc.current("lhs");
  expect(activation).toMatchObject({
    view: "a",
    phrase: "hello",
    segment: "s1",
  });
  expect(activation).not.toHaveProperty("quiet");
  expect(slots.showSlot).toHaveBeenCalledWith(
    "lhs",
    "0 0 260px",
    expect.objectContaining({ view: "a", phrase: "hello", segment: "s1" }),
    false,
  );
});

test("the modal is shown paint-gated; a dock never is", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "modal" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  expect(slots.showSlot).toHaveBeenCalledWith(
    "modal",
    100,
    expect.anything(),
    true,
  );

  getMeta.mockReturnValue({ dock: "lhs" });
  await lc.open("b");
  expect(slots.showSlot).toHaveBeenLastCalledWith(
    "lhs",
    "0 0 260px",
    expect.anything(),
    false,
  );
});

test("open on an already-focused sidebar slot toggles it closed instead of re-opening", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  slots.focusedSlot.mockReturnValue("lhs");
  slots.showSlot.mockClear();

  expect(await lc.open("a")).toBe(true);
  expect(slots.hideSlot).toHaveBeenCalledWith("lhs");
  expect(editor.focus).toHaveBeenCalled();
  expect(slots.showSlot).not.toHaveBeenCalled();
});

test("a focus=false open never takes the toggle-closed branch, and carries its opts into the activation", async () => {
  // Falsifiability: without the focus guard, a mention click that re-opens
  // an already-focused Mention Inbox to preset its dropdown would close it
  // instead.
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  slots.focusedSlot.mockReturnValue("lhs");
  slots.showSlot.mockClear();

  expect(await lc.open("a", { focus: false, dropdown: "People/Pete" })).toBe(
    true,
  );
  expect(slots.hideSlot).not.toHaveBeenCalled();
  expect(slots.showSlot).toHaveBeenCalledWith(
    "lhs",
    expect.anything(),
    expect.objectContaining({
      view: "a",
      focus: false,
      dropdown: "People/Pete",
    }),
    false,
  );
});

test("restoreDocks' passive restore never takes the toggle-closed branch, even if the slot reports focused", async () => {
  // Falsifiability: without the `!passive` guard, a boot restore landing on
  // a slot the editor reports as focused would hide the panel it's meant to
  // bring back instead of showing it.
  const { config, getMeta } = makeConfig({ sidebarSlots: ["lhs"] } as any);
  datastore.get.mockResolvedValue("a");
  getMeta.mockReturnValue({ dock: "lhs" });
  slots.focusedSlot.mockReturnValue("lhs");
  const lc = createPanelLifecycle(config);

  await lc.restoreDocks();

  expect(slots.hideSlot).not.toHaveBeenCalled();
  expect(slots.showSlot).toHaveBeenCalled();
});

test("a newer open() supersedes the previous occupant of the same slot after the slot is shown", async () => {
  const { config, getMeta, onSuperseded } = makeConfig();
  getMeta.mockReturnValue({ dock: "modal" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  expect(onSuperseded).not.toHaveBeenCalled();

  const callOrder: string[] = [];
  slots.showSlot.mockImplementation(() => callOrder.push("show"));
  onSuperseded.mockImplementation(() => callOrder.push("superseded"));

  await lc.open("b");
  expect(onSuperseded).toHaveBeenCalledWith("a");
  // Pins the ordering the navigator round explicitly preserved: supersede
  // fires only after the success-path show has gone out, not before it (a
  // plain trailing call after `pendingActivation.set` would fire too early).
  expect(callOrder).toEqual(["show", "superseded"]);
});

test("a throw mid-activation still supersedes the previous occupant (finally, not a trailing call)", async () => {
  // Falsifiability: replacing the `finally` with a plain call after the show
  // would leave `onSuperseded` uncalled here, since `datastore.get` rejects
  // before that line is ever reached.
  const { config, getMeta, onSuperseded } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  datastore.get.mockRejectedValueOnce(new Error("boom"));

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

test("hide fires onSlotClosedWithoutSuccessor only when the expected token matches the current activation", async () => {
  const { config, getMeta, onSlotClosedWithoutSuccessor } = makeConfig();
  getMeta.mockReturnValue({ dock: "modal" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  const staleToken = lc.current("modal")!.token;
  await lc.open("b"); // b now occupies "modal" with a newer token

  // Falsifiability: without the token check, this stale close (naming a's
  // now-superseded token) would settle *b* -- the pick the user hasn't
  // acted on yet -- with nil.
  await lc.hide("modal", staleToken);
  expect(onSlotClosedWithoutSuccessor).not.toHaveBeenCalled();
  expect(slots.hideSlot).not.toHaveBeenCalled();

  const freshToken = lc.current("modal")!.token;
  await lc.hide("modal", freshToken);
  expect(onSlotClosedWithoutSuccessor).toHaveBeenCalledWith("b");
  expect(slots.hideSlot).toHaveBeenCalledWith("modal");
});

test("hide with no expected token closes whatever occupies the slot", async () => {
  const { config, getMeta, onSlotClosedWithoutSuccessor } = makeConfig();
  getMeta.mockReturnValue({ dock: "modal" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  await lc.hide("modal");
  expect(onSlotClosedWithoutSuccessor).toHaveBeenCalledWith("a");
  expect(lc.current("modal")).toBeUndefined();
});

test("hide un-remembers a sidebar dock (datastore.del) but never touches the modal slot's dockedKey", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  await lc.hide("lhs");
  expect(datastore.del).toHaveBeenCalledWith(["navigator", "docked", "lhs"]);

  datastore.del.mockClear();
  getMeta.mockReturnValue({ dock: "modal" });
  await lc.open("b");
  await lc.hide("modal");
  expect(datastore.del).not.toHaveBeenCalled();
});

test("replaceInSlot never persists to dockedKey, unlike open", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.replaceInSlot("lhs", "a", {});
  expect(datastore.set).not.toHaveBeenCalledWith(
    ["navigator", "docked", "lhs"],
    expect.anything(),
  );
});

test("replaceInSlot reuses the slot's current width mode rather than the target's own saved width", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.open("a"); // no saved width -> default 260 -> "0 0 260px"
  await lc.resize({ slot: "lhs", width: 321, commit: true });
  slots.showSlot.mockClear();

  await lc.replaceInSlot("lhs", "b", {});
  expect(slots.showSlot).toHaveBeenCalledWith(
    "lhs",
    "0 0 321px",
    expect.objectContaining({ view: "b" }),
    false,
  );
  expect(datastore.get).not.toHaveBeenCalledWith(["navigator", "b", "width"]);
});

test("replaceInSlot also supersedes the previous occupant", async () => {
  const { config, getMeta, onSuperseded } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  await lc.replaceInSlot("lhs", "b", {});
  expect(onSuperseded).toHaveBeenCalledWith("a");
});

test("resize re-shows the dock at the clamped width, and only a commit persists it", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  slots.showSlot.mockClear();

  await lc.resize({ slot: "lhs", width: 900 }); // above max
  expect(datastore.set).not.toHaveBeenCalledWith(
    ["navigator", "a", "width"],
    expect.anything(),
  );
  expect(slots.showSlot).toHaveBeenCalledWith(
    "lhs",
    "0 0 600px",
    lc.current("lhs"),
  );

  await lc.resize({ slot: "lhs", width: 321, commit: true });
  expect(datastore.set).toHaveBeenCalledWith(["navigator", "a", "width"], 321);
});

test("a resize keeps the slot's activation identity, so it never re-activates the panel", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.open("a");
  const activation = lc.current("lhs");
  await lc.resize({ slot: "lhs", width: 300 });

  expect(slots.showSlot).toHaveBeenLastCalledWith(
    "lhs",
    "0 0 300px",
    activation,
  );
  expect(lc.current("lhs")).toBe(activation);
});

test("a stray resize with nothing in the slot is dropped", async () => {
  const { config } = makeConfig();
  const lc = createPanelLifecycle(config);

  await lc.resize({ slot: "lhs", width: 300 });
  expect(slots.showSlot).not.toHaveBeenCalled();
});

test("a resize tick that lands after a real close is dropped", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);
  await lc.open("a");
  await lc.hide("lhs");
  slots.showSlot.mockClear();

  await lc.resize({ slot: "lhs", width: 300 });
  expect(slots.showSlot).not.toHaveBeenCalled();
});

test("a resize whose commit is interleaved by a close never re-shows the panel", async () => {
  // Falsifiability: without the post-commit re-check, this would re-show (and
  // so reopen) a dock the user closed mid-drag.
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);
  await lc.open("a");
  slots.showSlot.mockClear();

  let resolveSet!: () => void;
  datastore.set.mockImplementation(
    () => new Promise<void>((resolve) => (resolveSet = resolve)),
  );
  const resizePromise = lc.resize({ slot: "lhs", width: 300, commit: true });
  datastore.set.mockResolvedValue(undefined);
  await lc.hide("lhs");

  resolveSet();
  await resizePromise;
  expect(slots.showSlot).not.toHaveBeenCalled();
});

test("restoreDocks skips entirely on a narrow screen", async () => {
  const { config, getForcedOpens } = makeConfig();
  mobile.isNarrowScreen.mockReturnValue(true);
  const lc = createPanelLifecycle(config);

  await lc.restoreDocks();
  expect(getForcedOpens).not.toHaveBeenCalled();
  expect(datastore.get).not.toHaveBeenCalled();
  expect(slots.showSlot).not.toHaveBeenCalled();
});

test("restoreDocks: a forced (openOnStart-equivalent) view beats a saved dockedKey for the same slot", async () => {
  const { config, getMeta, getForcedOpens } = makeConfig({
    sidebarSlots: ["lhs"],
  } as any);
  getForcedOpens.mockReturnValue([{ name: "forced", dock: "lhs" }]);
  getMeta.mockReturnValue({ dock: "lhs" });
  const lc = createPanelLifecycle(config);

  await lc.restoreDocks();

  expect(datastore.get).not.toHaveBeenCalledWith([
    "navigator",
    "docked",
    "lhs",
  ]);
  expect(slots.showSlot).toHaveBeenCalled();
  expect(lc.current("lhs")).toMatchObject({
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

  expect(datastore.del).toHaveBeenCalledWith(["navigator", "docked", "lhs"]);
  expect(slots.showSlot).not.toHaveBeenCalled();
});

test("restoreDocks: a view re-docked via moveDock still restores -- resolveDock decides, not the static meta.dock", async () => {
  // The saved dockedKey remembers "v" in rhs (where moveDock last put it),
  // but "v"'s declared meta.dock is still its original default (modal).
  // Without resolveDock in the loop this reads as a stale mismatch and the
  // dock would be forgotten on every reload after a switch.
  const { config, getMeta } = makeConfig({
    sidebarSlots: ["rhs"],
    resolveDock: () => Promise.resolve("rhs"),
  } as any);
  datastore.get.mockResolvedValue("v");
  getMeta.mockReturnValue({ dock: "modal", supportedDocks: ["modal", "rhs"] });
  const lc = createPanelLifecycle(config);

  await lc.restoreDocks();

  expect(datastore.del).not.toHaveBeenCalledWith([
    "navigator",
    "docked",
    "rhs",
  ]);
  expect(slots.showSlot).toHaveBeenCalled();
  expect(lc.current("rhs")).toMatchObject({ view: "v", passive: true });
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
  expect(slots.showSlot).not.toHaveBeenCalled();
});

test("resolveDock overrides the meta's declared dock", async () => {
  const { config, getMeta } = makeConfig({
    resolveDock: () => Promise.resolve("rhs"),
  });
  getMeta.mockReturnValue({ dock: "modal" });
  const lc = createPanelLifecycle(config);
  await lc.open("v");
  expect(slots.showSlot).toHaveBeenCalledWith(
    "rhs",
    expect.anything(),
    expect.objectContaining({ view: "v" }),
    false,
  );
});

test("closing a displacing view restores the displaced one (one-deep)", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockImplementation((name: string) =>
    name === "a" || name === "b" ? { dock: "rhs" } : undefined,
  );
  const lc = createPanelLifecycle(config);
  await lc.open("a");
  await lc.open("b"); // displaces a
  slots.showSlot.mockClear();
  await lc.hide("rhs");
  // a came back, passively
  expect(slots.showSlot).toHaveBeenCalledWith(
    "rhs",
    expect.anything(),
    expect.objectContaining({ view: "a", passive: true }),
    false,
  );
});

test("closing a view that displaced nothing just closes", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockReturnValue({ dock: "rhs" });
  const lc = createPanelLifecycle(config);
  await lc.open("a");
  slots.showSlot.mockClear();
  await lc.hide("rhs");
  expect(slots.showSlot).not.toHaveBeenCalled();
  expect(slots.hideSlot).toHaveBeenCalledWith("rhs");
});

test("an A -> B -> A sequence restores B on close: the latest displacement wins, one-deep", async () => {
  const { config, getMeta } = makeConfig();
  getMeta.mockImplementation((name: string) =>
    name === "a" || name === "b" ? { dock: "rhs" } : undefined,
  );
  const lc = createPanelLifecycle(config);
  await lc.open("a");
  await lc.open("b"); // displaces a
  await lc.open("a"); // re-opening a now displaces b
  slots.showSlot.mockClear();
  await lc.hide("rhs");
  expect(slots.showSlot).toHaveBeenCalledWith(
    "rhs",
    expect.anything(),
    expect.objectContaining({ view: "b", passive: true }),
    false,
  );
});
