import { sleep } from "@silverbulletmd/silverbullet/lib/async";
import { parseToRef } from "@silverbulletmd/silverbullet/lib/ref";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { describe, expect, test, vi } from "vitest";
import { createMockSystem } from "../plug-api/system_mock.ts";
import { resolveAnchor } from "../plugs/index/api.ts";
import { indexMarkdown } from "../plugs/index/indexer.ts";
import { MemoryKvPrimitives } from "./data/memory_kv_primitives.ts";
import { EventHook } from "./plugos/hooks/event.ts";
import { Space } from "./space.ts";
import { DataStoreSpacePrimitives } from "./spaces/datastore_space_primitives.ts";
import type { SpacePrimitives } from "./spaces/space_primitives.ts";

const testPage = `
Some paragraph
# Header 1
Some text

# Header 2
* Item 1
  * Sub item
* [ ] Task 1
  * Sub item 2
    * Sub-sub item
`.trim();

test("watched files use cheap observing metadata probes", async () => {
  vi.useFakeTimers();
  const calls: unknown[][] = [];
  const primitives = {
    fetchFileList: async () => [],
    getFileMeta: async (...args: unknown[]) => {
      calls.push(args);
      return {
        name: "clip.mp4",
        contentType: "video/mp4",
        size: 10,
        created: 0,
        lastModified: 0,
        perm: "rw",
      };
    },
  } as unknown as SpacePrimitives;
  const space = new Space(primitives, new EventHook());
  try {
    space.watchFile("clip.mp4");
    space.watch();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toContainEqual(["clip.mp4", true, "cheap"]);
  } finally {
    space.unwatch();
    vi.useRealTimers();
  }
});

test("readRef checks", async () => {
  const kv = new MemoryKvPrimitives();
  const eventHook = new EventHook();
  const space = new Space(new DataStoreSpacePrimitives(kv), eventHook);
  await sleep(1);
  await space.writePage("test", testPage);

  expect(await space.readRef(parseToRef("test")!)).toEqual({
    text: testPage,
    offset: 0,
  });

  expect(await space.readRef(parseToRef("test@0")!)).toEqual({
    text: "Some paragraph",
    offset: 0,
  });

  expect(await space.readRef(parseToRef("test@l1c1")!)).toEqual({
    text: "Some paragraph",
    offset: 0,
  });

  expect(await space.readRef(parseToRef("test#Header 1")!)).toEqual({
    text: "# Header 1\nSome text\n\n",
    offset: testPage.indexOf("# Header 1"),
  });
  expect(await space.readRef(parseToRef("test#Header 2")!)).toEqual({
    text: "# Header 2\n* Item 1\n  * Sub item\n* [ ] Task 1\n  * Sub item 2\n    * Sub-sub item",
    offset: testPage.indexOf("# Header 2"),
  });

  const itemPos = testPage.indexOf("* Item 1");
  expect(await space.readRef(parseToRef(`test@${itemPos}`)!)).toEqual({
    text: "* Item 1\n  * Sub item",
    offset: itemPos,
  });

  const taskPos = testPage.indexOf("* [ ] Task 1");
  expect(await space.readRef(parseToRef(`test@${taskPos}`)!)).toEqual({
    text: "* [ ] Task 1\n  * Sub item 2\n    * Sub-sub item",
    offset: taskPos,
  });

  const subItemPos = testPage.indexOf("* Sub item 2");
  expect(await space.readRef(parseToRef(`test@${subItemPos}`)!)).toEqual({
    text: "* Sub item 2\n  * Sub-sub item",
    offset: subItemPos,
  });
});

const makeMeta = (name: string): PageMeta => ({
  ref: name,
  tag: "page",
  name,
  perm: "rw",
  lastModified: "",
  created: "",
});

/**
 * Indexes a page's markdown into the mock system index.
 */
async function indexPage(text: string, name: string): Promise<void> {
  const objects = await indexMarkdown(text, makeMeta(name));
  await (globalThis as any).syscall("index.indexObjects", name, objects);
}

describe("readRef anchor variant", () => {
  test("readRef resolves bare anchor $pete", async () => {
    createMockSystem();
    const kv = new MemoryKvPrimitives();
    const eventHook = new EventHook();
    const pageContent = "Anchored para $pete here.";
    const space = new Space(
      new DataStoreSpacePrimitives(kv),
      eventHook,
      (name, page) => resolveAnchor(name, page),
    );
    await sleep(1);
    await space.writePage("Other", pageContent);
    await indexPage(pageContent, "Other");

    const result = await space.readRef(parseToRef("$pete")!);
    expect(result.text).toBe("Anchored para $pete here.");
  });

  test("readRef resolves page-qualified anchor Other$pete", async () => {
    createMockSystem();
    const kv = new MemoryKvPrimitives();
    const eventHook = new EventHook();
    const pageContent = "Anchored para $pete here.";
    const space = new Space(
      new DataStoreSpacePrimitives(kv),
      eventHook,
      (name, page) => resolveAnchor(name, page),
    );
    await sleep(1);
    await space.writePage("Other", pageContent);
    await indexPage(pageContent, "Other");

    const result = await space.readRef(parseToRef("Other$pete")!);
    expect(result.text).toBe("Anchored para $pete here.");
  });

  test("readRef throws on missing anchor", async () => {
    createMockSystem();
    const kv = new MemoryKvPrimitives();
    const eventHook = new EventHook();
    const space = new Space(
      new DataStoreSpacePrimitives(kv),
      eventHook,
      (name, page) => resolveAnchor(name, page),
    );
    await sleep(1);
    await indexPage("Normal paragraph.\n", "SomePage");

    await expect(space.readRef(parseToRef("$nope")!)).rejects.toThrow(
      /Anchor not found/,
    );
  });

  test("readRef throws on duplicate anchor", async () => {
    createMockSystem();
    const kv = new MemoryKvPrimitives();
    const eventHook = new EventHook();
    const space = new Space(
      new DataStoreSpacePrimitives(kv),
      eventHook,
      (name, page) => resolveAnchor(name, page),
    );
    await sleep(1);
    await space.writePage("PageA", "First $pete anchor.");
    await space.writePage("PageB", "Second $pete anchor.");
    await indexPage("First $pete anchor.", "PageA");
    await indexPage("Second $pete anchor.", "PageB");

    await expect(space.readRef(parseToRef("$pete")!)).rejects.toThrow(
      /Duplicate anchor/,
    );
  });
});
