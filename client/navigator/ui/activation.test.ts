import { expect, test, vi } from "vitest";

/**
 * `createActivate` exercised directly against a minimal fake engine, pinning
 * the carried-dropdown contract: a `dropdown` value in the activation applies
 * to that activation only (never persisted), and the next open without one
 * restores the remembered selection.
 */

const datastore = {
  get: vi.fn<(key: unknown[]) => Promise<unknown>>(),
  set: vi.fn<(key: unknown[], value: unknown) => Promise<void>>(),
};
const editor = {
  getCurrentPage: vi.fn<() => Promise<string>>(async () => "Page"),
};

vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  datastore,
  editor,
}));

const { createActivate } = await import("./activation.ts");

function makeHarness(remembered: unknown) {
  datastore.get.mockReset();
  datastore.set.mockReset();
  datastore.get.mockImplementation((key: unknown[]) =>
    Promise.resolve(
      Array.isArray(key) && key[2] === "dropdown" ? remembered : undefined,
    ),
  );
  const state = {
    meta: { name: "inbox", dropdown: { placeholder: "Recipient" } },
    ctx: { phrase: "" },
    dropdownOptions: [
      { label: "Pete", value: "People/Pete" },
      { label: "Sales", value: "recipient:sales" },
    ],
  };
  const engine = {
    dropIfRedefined: vi.fn(async () => false),
    dropIfEphemeral: vi.fn(),
    isLoaded: vi.fn(() => false),
    activate: vi.fn(async () => state),
    activeState: vi.fn(() => state),
    refresh: vi.fn(async () => {}),
  };
  const ref = <T>(value: T) => ({ current: value });
  const refs = {
    displayed: ref<string | undefined>(undefined),
    handledToken: ref<number | undefined>(undefined),
    segmentForced: ref(false),
    dropdownForced: ref(false),
    revealedFor: ref<string | undefined>(undefined),
    revealedPage: ref<string | undefined>(undefined),
    view: ref<any>(undefined),
    phrase: ref(""),
    interaction: ref<"typing" | "navigating">("typing"),
    returnTo: ref<string | undefined>(undefined),
    segmentDirty: ref(false),
    dropdownDirty: ref(false),
    expandedDirty: ref(false),
    lastQueried: ref<string | undefined>(undefined),
    readySignaledToken: ref<number | undefined>(undefined),
  };
  const setDropdownValue = vi.fn();
  const set = {
    setView: vi.fn(),
    setBootError: vi.fn(),
    setPhrase: vi.fn(),
    setSegmentIndex: vi.fn(),
    setDropdownValue,
    setSelectedIndex: vi.fn(),
    setSelectedPath: vi.fn(),
    setExpanded: vi.fn(),
  };
  const activate = createActivate({
    slot: "rhs",
    engine: engine as any,
    refs: refs as any,
    listenForRefresh: vi.fn(),
    set: set as any,
    publish: vi.fn(),
    syncReadOnly: vi.fn(async () => {}),
    applyReveal: vi.fn(),
    focusInput: vi.fn(),
    signalReady: vi.fn(),
  });
  return { activate, setDropdownValue, refs };
}

async function settled() {
  // Lets the fire-and-forget datastore reads inside activate land.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("a carried dropdown value applies to that activation only, unpersisted", async () => {
  const { activate, setDropdownValue } = makeHarness("People/Pete");

  await activate({
    view: "inbox",
    token: 1,
    dropdown: "recipient:sales",
    focus: false,
  });
  await settled();
  expect(setDropdownValue).toHaveBeenCalledWith("recipient:sales");
  // Ephemeral by design: the carried value is never written back.
  expect(datastore.set).not.toHaveBeenCalled();

  // The next open without a carried value restores the remembered
  // (hand-picked) selection rather than staying on the forced one.
  setDropdownValue.mockClear();
  await activate({ view: "inbox", token: 2 });
  await settled();
  expect(setDropdownValue).toHaveBeenCalledWith(undefined);
  expect(setDropdownValue).toHaveBeenLastCalledWith("People/Pete");
});

test("without a remembered value, the open after a carried one is back on All", async () => {
  const { activate, setDropdownValue } = makeHarness(undefined);

  await activate({
    view: "inbox",
    token: 1,
    dropdown: "recipient:sales",
    focus: false,
  });
  await settled();
  expect(setDropdownValue).toHaveBeenLastCalledWith("recipient:sales");

  setDropdownValue.mockClear();
  await activate({ view: "inbox", token: 2 });
  await settled();
  // Nothing remembered: the reset to the built-in "All" is the last word.
  expect(setDropdownValue).toHaveBeenLastCalledWith(undefined);
});
