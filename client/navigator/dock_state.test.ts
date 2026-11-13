import { expect, test } from "vitest";
import { createDockState } from "./dock_state.ts";

function fakeStore(seed: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(seed));
  const k = (key: unknown[]) => JSON.stringify(key);
  return {
    data,
    store: {
      get: (key: unknown[]) => Promise.resolve(data.get(k(key))),
      set: (key: unknown[], value: unknown) => {
        data.set(k(key), value);
        return Promise.resolve();
      },
      del: (key: unknown[]) => {
        data.delete(k(key));
        return Promise.resolve();
      },
    },
  };
}

const META = { dock: "modal", supportedDocks: ["modal", "rhs", "page-bottom"] };

test("resolveDock falls back meta -> space config -> datastore override", async () => {
  const { store } = fakeStore();
  const defaults: Record<string, { dock?: string }> = {};
  const ds = createDockState({ store, spaceDefaults: (n) => defaults[n] });
  expect(await ds.resolveDock("v", META)).toBe("modal");
  defaults.v = { dock: "rhs" };
  expect(await ds.resolveDock("v", META)).toBe("rhs");
  await ds.setDock("v", "page-bottom");
  expect(await ds.resolveDock("v", META)).toBe("page-bottom");
});

test("unsupported values fall through to the next level", async () => {
  const { store } = fakeStore({
    '["navigator","v","dock"]': "lhs", // not in supportedDocks
  });
  const ds = createDockState({
    store,
    spaceDefaults: () => ({ dock: "bogus" }),
  });
  expect(await ds.resolveDock("v", META)).toBe("modal");
});

// Anything but a stored `true` reads as expanded, so a key holding junk (an
// older format, a hand-edited datastore) degrades to the default rather than
// rolling a widget up with nothing on screen to say why.
test("a non-boolean collapsed value reads as expanded", async () => {
  const { store } = fakeStore({ '["navigator","v","collapsed"]': "yes" });
  const ds = createDockState({ store, spaceDefaults: () => undefined });
  expect(await ds.isCollapsed("v")).toBe(false);
});

test("open falls back defaultOpen -> config -> datastore", async () => {
  const { store } = fakeStore();
  const defaults: Record<string, { open?: boolean }> = {};
  const ds = createDockState({ store, spaceDefaults: (n) => defaults[n] });

  expect(await ds.isOpen("v", { ...META, defaultOpen: true })).toBe(true);
  defaults.v = { open: false };
  expect(await ds.isOpen("v", { ...META, defaultOpen: true })).toBe(false);
  await ds.setOpen("v", true);
  expect(await ds.isOpen("v", { ...META, defaultOpen: true })).toBe(true);
});

test("collapsed falls back false -> config -> datastore", async () => {
  const { store } = fakeStore();
  const defaults: Record<string, { collapsed?: boolean }> = {};
  const ds = createDockState({ store, spaceDefaults: (n) => defaults[n] });

  expect(await ds.isCollapsed("v")).toBe(false);
  defaults.v = { collapsed: true };
  expect(await ds.isCollapsed("v")).toBe(true);
  await ds.setCollapsed("v", false);
  expect(await ds.isCollapsed("v")).toBe(false);
});

test("sidebarDefaultOpen reads config and the datastore, never defaultOpen", async () => {
  const { store } = fakeStore();
  const defaults: Record<string, { open?: boolean }> = {};
  const ds = createDockState({ store, spaceDefaults: (n) => defaults[n] });

  // Sidebar declarations ignore defaultOpen.
  expect(await ds.sidebarDefaultOpen("v")).toBe(false);
  defaults.v = { open: true };
  expect(await ds.sidebarDefaultOpen("v")).toBe(true);
  await ds.setOpen("v", false);
  expect(await ds.sidebarDefaultOpen("v")).toBe(false);
});
