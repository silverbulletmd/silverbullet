import { expect, test } from "@jest/globals";
import { IndexedDBSpacePrimitives } from "./indexeddb_space_primitives";
import { SpaceSync } from "./sync";
import { PageMeta } from "../types";
import { Space } from "./space";

// For testing in node.js
require("fake-indexeddb/auto");

test("Test store", async () => {
  let primary = new Space(new IndexedDBSpacePrimitives("primary"), true);
  let secondary = new Space(
    new IndexedDBSpacePrimitives("secondary", -5000),
    true
  );
  let sync = new SpaceSync(primary, secondary, 0, 0, "_trash/");

  async function conflictResolver(pageMeta1: PageMeta, pageMeta2: PageMeta) {}

  // Write one page to primary
  await primary.writePage("index", "Hello");
  expect((await secondary.listPages()).size).toBe(0);
  await syncPages(conflictResolver);
  expect((await secondary.listPages()).size).toBe(1);
  expect((await secondary.readPage("index")).text).toBe("Hello");

  // Should be a no-op
  expect(await syncPages()).toBe(0);

  // Now let's make a change on the secondary
  await secondary.writePage("index", "Hello!!");
  await secondary.writePage("test", "Test page");

  // And sync it
  await syncPages();

  expect(primary.listPages().size).toBe(2);
  expect(secondary.listPages().size).toBe(2);

  expect((await primary.readPage("index")).text).toBe("Hello!!");

  // Let's make some random edits on both ends
  await primary.writePage("index", "1");
  await primary.writePage("index2", "2");
  await secondary.writePage("index3", "3");
  await secondary.writePage("index4", "4");
  await syncPages();

  expect((await primary.listPages()).size).toBe(5);
  expect((await secondary.listPages()).size).toBe(5);

  expect(await syncPages()).toBe(0);

  console.log("Deleting pages");
  // Delete some pages
  await primary.deletePage("index");
  await primary.deletePage("index3");

  console.log("Pages", await primary.listPages());
  console.log("Trash", await primary.listTrash());

  await syncPages();

  expect((await primary.listPages()).size).toBe(3);
  expect((await secondary.listPages()).size).toBe(3);

  // No-op
  expect(await syncPages()).toBe(0);

  await secondary.deletePage("index4");
  await primary.deletePage("index2");

  await syncPages();

  // Just "test" left
  expect((await primary.listPages()).size).toBe(1);
  expect((await secondary.listPages()).size).toBe(1);

  // No-op
  expect(await syncPages()).toBe(0);

  await secondary.writePage("index", "I'm back");

  await syncPages();

  expect((await primary.readPage("index")).text).toBe("I'm back");

  // Cause a conflict
  await primary.writePage("index", "Hello 1");
  await secondary.writePage("index", "Hello 2");

  await syncPages(SpaceSync.primaryConflictResolver(primary, secondary));

  // Sync conflicting copy back
  await syncPages();

  // Verify that primary won
  expect((await primary.readPage("index")).text).toBe("Hello 1");
  expect((await secondary.readPage("index")).text).toBe("Hello 1");

  // test + index + index.conflicting copy
  expect((await primary.listPages()).size).toBe(3);
  expect((await secondary.listPages()).size).toBe(3);

  async function syncPages(
    conflictResolver?: (
      pageMeta1: PageMeta,
      pageMeta2: PageMeta
    ) => Promise<void>
  ): Promise<number> {
    // Awesome practice: adding sleeps to fix issues!
    await sleep(2);
    let n = await sync.syncPages(conflictResolver);
    await sleep(2);
    return n;
  }
});

function sleep(ms: number = 5): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
