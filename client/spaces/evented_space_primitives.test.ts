import type { EventHookT } from "@silverbulletmd/silverbullet/type/manifest";
import { expect, test } from "vitest";
import { EventedSpacePrimitives } from "./evented_space_primitives.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { System } from "../plugos/system.ts";
import { DataStore } from "../data/datastore.ts";
import { MemoryKvPrimitives } from "../data/memory_kv_primitives.ts";
import type { SpacePrimitives } from "./space_primitives.ts";
import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";

class MockSpacePrimitives implements SpacePrimitives {
  files = new Map<string, { data: Uint8Array; meta: FileMeta }>();

  async fetchFileList(): Promise<FileMeta[]> {
    return Array.from(this.files.values()).map((f) => f.meta);
  }

  async getFileMeta(path: string): Promise<FileMeta> {
    const file = this.files.get(path);
    if (!file) throw new Error("File not found");
    return file.meta;
  }

  async readFile(path: string): Promise<{ data: Uint8Array; meta: FileMeta }> {
    const file = this.files.get(path);
    if (!file) throw new Error("File not found");
    return file;
  }

  async writeFile(
    path: string,
    data: Uint8Array,
    meta?: Partial<FileMeta>,
  ): Promise<FileMeta> {
    const fileMeta: FileMeta = {
      name: path,
      lastModified: meta?.lastModified ?? Date.now(),
      size: data.length,
      contentType: "text/markdown",
      created: meta?.created ?? Date.now(),
      perm: meta?.perm ?? "rw",
    };
    this.files.set(path, { data, meta: fileMeta });
    return fileMeta;
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }
}

test("EventedSpacePrimitives - files:changed batch event dispatching", async () => {
  const mockPrimitives = new MockSpacePrimitives();
  const db = new MemoryKvPrimitives();
  const ds = new DataStore(db);
  const eventHook = new EventHook();
  const system = new System<EventHookT>();
  system.addHook(eventHook);

  // Create three files in the mock primitives
  await mockPrimitives.writeFile("file1.md", new Uint8Array([1]));
  await mockPrimitives.writeFile("file2.md", new Uint8Array([2]));
  await mockPrimitives.writeFile("file3.md", new Uint8Array([3]));

  const evented = new EventedSpacePrimitives(mockPrimitives, eventHook, ds);
  await evented.enable();

  const fileChangedEvents: string[] = [];
  const filesChangedEvents: string[][] = [];

  eventHook.addLocalListener("file:changed", (name: string) => {
    fileChangedEvents.push(name);
  });

  eventHook.addLocalListener("files:changed", (names: string[]) => {
    filesChangedEvents.push(names);
  });

  // Call fetchFileList on the empty evented space (it should think all 3 are new)
  await evented.fetchFileList();

  expect(fileChangedEvents.sort()).toEqual(["file1.md", "file2.md", "file3.md"]);
  expect(filesChangedEvents.length).toBe(1);
  expect(filesChangedEvents[0].sort()).toEqual([
    "file1.md",
    "file2.md",
    "file3.md",
  ]);

  // Clear events
  fileChangedEvents.length = 0;
  filesChangedEvents.length = 0;

  // Modify file1.md
  await mockPrimitives.writeFile("file1.md", new Uint8Array([1, 2]), {
    name: "file1.md",
    lastModified: Date.now() + 1000,
    size: 2,
    contentType: "text/markdown",
  });

  // Fetch list again, only file1.md should be changed
  await evented.fetchFileList();
  expect(fileChangedEvents).toEqual(["file1.md"]);
  expect(filesChangedEvents).toEqual([["file1.md"]]);

  // Clean up
  await db.close();
});
