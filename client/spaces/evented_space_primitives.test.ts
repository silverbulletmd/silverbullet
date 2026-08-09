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
