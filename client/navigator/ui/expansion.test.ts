import { expect, test } from "vitest";
import {
  createInlineExpansion,
  expansionKey,
  inlineExpansionKey,
} from "./expansion.ts";

test("expansionKey keeps the two readings apart", () => {
  expect(
    expansionKey("someTree", { expandAll: true, expansionScope: "view" }),
  ).toEqual(["navigator", "someTree", "collapsed"]);
  expect(
    expansionKey("std.spaceTree", { expandAll: false, expansionScope: "view" }),
  ).toEqual(["navigator", "std.spaceTree", "expanded"]);
});

test("expansionKey: a page-scoped tree has nowhere to persist to", () => {
  // Its paths are one page's content, so a stored set would land on top of a
  // different page's rows -- see the `expansionScope` docs.
  expect(
    expansionKey("std.toc", { expandAll: true, expansionScope: "page" }),
  ).toBeUndefined();
  expect(
    expansionKey("std.toc", { expandAll: false, expansionScope: "page" }),
  ).toBeUndefined();
});

test("expansionKey: an ephemeral (navigator.pick) view has nowhere to persist to either", () => {
  expect(
    expansionKey("__pick:1", {
      expandAll: true,
      expansionScope: "view",
      ephemeral: true,
    }),
  ).toBeUndefined();
});

test("inline expansion keys isolate pages, values, and inverse expandAll state", () => {
  expect(inlineExpansionKey("Notes/First", "outline", false)).toEqual([
    "navigator",
    "inline",
    "Notes/First",
    "outline",
    "expanded",
  ]);
  expect(inlineExpansionKey("Notes/Second", "outline", false)).toEqual([
    "navigator",
    "inline",
    "Notes/Second",
    "outline",
    "expanded",
  ]);
  expect(inlineExpansionKey("Notes/First", "other", false)).toEqual([
    "navigator",
    "inline",
    "Notes/First",
    "other",
    "expanded",
  ]);
  expect(inlineExpansionKey("Notes/First", "outline", true)).toEqual([
    "navigator",
    "inline",
    "Notes/First",
    "outline",
    "collapsed",
  ]);
  expect(inlineExpansionKey("Notes/First", undefined, false)).toBeUndefined();
});

test("keyed inline expansion restores before ready and stores collapsed exceptions", async () => {
  let releaseRead!: (value: unknown) => void;
  const writes: { key: string[]; paths: string[] }[] = [];
  const store = {
    get: () =>
      new Promise<unknown>((resolve) => {
        releaseRead = resolve;
      }),
    set: async (key: string[], paths: string[]) => {
      writes.push({ key, paths });
    },
  };
  const state = createInlineExpansion(
    inlineExpansionKey("Notes/First", "outline", true),
    store,
    () => {},
  );
  expect(state.ready).toBe(false);
  const loading = state.load();
  releaseRead(["Notes/Closed"]);
  await loading;
  expect(state.ready).toBe(true);
  expect([...state.expanded]).toEqual(["Notes/Closed"]);
  state.toggle("Notes/Open");
  await state.flush();
  expect(writes).toEqual([
    {
      key: ["navigator", "inline", "Notes/First", "outline", "collapsed"],
      paths: ["Notes/Closed", "Notes/Open"],
    },
  ]);
});

test("unkeyed expansion is transient and a disposed late read cannot change state", async () => {
  const writes: unknown[] = [];
  let releaseRead!: (value: unknown) => void;
  const store = {
    get: () =>
      new Promise<unknown>((resolve) => {
        releaseRead = resolve;
      }),
    set: async (...args: unknown[]) => {
      writes.push(args);
    },
  };
  const transient = createInlineExpansion(undefined, store, () => {});
  expect(transient.ready).toBe(true);
  transient.toggle("Notes/One");
  await transient.flush();
  expect([...transient.expanded]).toEqual(["Notes/One"]);
  expect(writes).toEqual([]);

  let changes = 0;
  const keyed = createInlineExpansion(
    ["navigator", "inline", "P", "k", "expanded"],
    store,
    () => {
      changes++;
    },
  );
  const loading = keyed.load();
  keyed.dispose();
  releaseRead(["Notes/Stale"]);
  await loading;
  expect(keyed.ready).toBe(false);
  expect([...keyed.expanded]).toEqual([]);
  expect(changes).toBe(0);
});

test("inline expansion writes snapshots in interaction order", async () => {
  let releaseFirst!: () => void;
  const writes: string[][] = [];
  const state = createInlineExpansion(
    ["navigator", "inline", "P", "k", "expanded"],
    {
      get: async () => [],
      set: (_key, paths) => {
        writes.push(paths);
        if (writes.length === 1) {
          return new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return Promise.resolve();
      },
    },
    () => {},
  );
  await state.load();
  state.toggle("Folder/One");
  state.toggle("Folder/Two");
  await Promise.resolve();
  expect(writes).toEqual([["Folder/One"]]);
  releaseFirst();
  await state.flush();
  expect(writes).toEqual([["Folder/One"], ["Folder/One", "Folder/Two"]]);
});
