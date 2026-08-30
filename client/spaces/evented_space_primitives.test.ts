import { describe, expect, test } from "vitest";
import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";
import { EventedSpacePrimitives } from "./evented_space_primitives.ts";
import type { SpacePrimitives } from "./space_primitives.ts";
import type { EventHook } from "../plugos/hooks/event.ts";
import type { DataStore } from "../data/datastore.ts";

function meta(name: string, lastModified: number): FileMeta {
  return {
    name,
    lastModified,
    created: lastModified,
    contentType: "text/markdown",
    size: 0,
    perm: "rw",
  };
}

function setup(lastModified = 2000) {
  const events: { name: string; args: unknown[] }[] = [];
  const wrapped = {
    readFile: async (path: string) => ({
      data: new Uint8Array(),
      meta: meta(path, lastModified),
    }),
    writeFile: async (path: string) => meta(path, lastModified),
    getFileMeta: async (path: string) => meta(path, lastModified),
  } as unknown as SpacePrimitives;
  const store = new Map<string, unknown>();
  const ds = {
    get: async (key: string[]) => store.get(key.join("/")),
    set: async (key: string[], value: unknown) => {
      store.set(key.join("/"), value);
    },
  } as unknown as DataStore;
  const eventHook = {
    dispatchEvent: async (name: string, ...args: unknown[]) => {
      events.push({ name, args });
      return [];
    },
  } as unknown as EventHook;
  const sp = new EventedSpacePrimitives(wrapped, eventHook, ds);
  return { sp, events };
}

const fileChanged = (events: { name: string; args: unknown[] }[]) =>
  events.filter((e) => e.name === "file:changed");

describe("EventedSpacePrimitives fetchFileList single-flight", () => {
  function listingSetup() {
    let listCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = setup();
    (base.sp as unknown as { wrapped: SpacePrimitives }).wrapped = {
      fetchFileList: async () => {
        listCalls++;
        await gate;
        return [meta("index.md", 2000)];
      },
    } as unknown as SpacePrimitives;
    return { ...base, release, listCalls: () => listCalls };
  }

  test("concurrent calls share one underlying listing", async () => {
    const { sp, release, listCalls } = listingSetup();
    await sp.enable();

    const [a, b] = [sp.fetchFileList(), sp.fetchFileList()];
    release();
    expect(await a).toEqual(await b);
    expect(listCalls()).toBe(1);
  });

  test("concurrent calls share one underlying listing before enable()", async () => {
    const { sp, release, listCalls } = listingSetup();

    const [a, b] = [sp.fetchFileList(), sp.fetchFileList()];
    release();
    expect(await a).toEqual(await b);
    expect(listCalls()).toBe(1);
  });

  test("a later call after completion fetches fresh", async () => {
    const { sp, release, listCalls } = listingSetup();
    await sp.enable();

    const first = sp.fetchFileList();
    release();
    await first;
    await sp.fetchFileList();
    expect(listCalls()).toBe(2);
  });
});

// file:changedBatch aggregates a dispatch cascade's file:changed events into
// one event so listeners can act on the whole set at once (e.g. a single
// index-queue batch send). It is dispatched and awaited BEFORE file:listed —
// the initial-index completion check listens for file:listed and must observe
// the queued batch, or a cold boot marks the index complete while empty.
describe("EventedSpacePrimitives file:changedBatch", () => {
  function listingSetup(files: FileMeta[]) {
    const base = setup();
    (base.sp as unknown as { wrapped: SpacePrimitives }).wrapped = {
      fetchFileList: async () => files,
      writeFile: async (path: string) => meta(path, 999),
    } as unknown as SpacePrimitives;
    return base;
  }

  test("a listing dispatches one awaited batch of all changed files, before file:listed", async () => {
    const { sp, events } = listingSetup([
      meta("a.md", 100),
      meta("b.md", 200),
      meta("c.png", 300),
    ]);
    await sp.enable();
    await sp.fetchFileList();

    const names = events.map((e) => e.name);
    const batchAt = names.indexOf("file:changedBatch");
    expect(batchAt).toBeGreaterThan(-1);
    expect(batchAt).toBeLessThan(names.indexOf("file:listed"));
    expect(events[batchAt].args).toEqual([["a.md", "b.md", "c.png"]]);
  });

  test("a listing with no changes dispatches no batch", async () => {
    const { sp, events } = listingSetup([meta("a.md", 100)]);
    await sp.enable();
    await sp.fetchFileList();
    await sp.fetchFileList();

    const batches = events.filter((e) => e.name === "file:changedBatch");
    expect(batches).toHaveLength(1);
  });

  test("a write dispatches a single-file batch", async () => {
    const { sp, events } = listingSetup([]);
    await sp.enable();
    await sp.writeFile("d.md", new Uint8Array());

    const batches = events.filter((e) => e.name === "file:changedBatch");
    expect(batches).toHaveLength(1);
    expect(batches[0].args).toEqual([["d.md"]]);
  });
});

// file:changed fires from inside writeFile, before it returns, so ownWrite is
// a listener's only way to tell its own write from somebody else's.
describe("EventedSpacePrimitives file:changed ownWrite flag", () => {
  test("a write of our own is flagged as such", async () => {
    const { sp, events } = setup();
    await sp.enable();

    await sp.writeFile("index.md", new Uint8Array());

    expect(fileChanged(events).map((e) => e.args)).toEqual([
      ["index.md", undefined, 2000, true],
    ]);
  });

  test("a change merely observed by a metadata probe is not", async () => {
    const { sp, events } = setup();
    await sp.enable();

    await sp.getFileMeta("index.md");

    expect(fileChanged(events).map((e) => e.args)).toEqual([
      ["index.md", undefined, 2000, false],
    ]);
  });

  test("a change merely observed by a read is not", async () => {
    const { sp, events } = setup();
    await sp.enable();

    await sp.readFile("index.md");

    expect(fileChanged(events).map((e) => e.args)).toEqual([
      ["index.md", undefined, 2000, false],
    ]);
  });
});
