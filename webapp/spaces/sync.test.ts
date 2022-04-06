import { expect, test } from "@jest/globals";
import { IndexedDBSpace } from "./indexeddb_space";
import { SpaceSync } from "./sync";
import { PageMeta } from "../../common/types";
import { WatchableSpace } from "./cache_space";

// For testing in node.js
require("fake-indexeddb/auto");

test("Test store", async () => {
  let primary = new WatchableSpace(new IndexedDBSpace("primary"), true);
  let secondary = new WatchableSpace(new IndexedDBSpace("secondary"), true);
  let sync = new SpaceSync(primary, secondary, 0, "_trash/");

  async function conflictResolver(pageMeta1: PageMeta, pageMeta2: PageMeta) {}

  // Write one page to primary
  await primary.writePage("start", "Hello");
  expect((await secondary.listPages()).size).toBe(0);
  await sync.syncPages(conflictResolver);
  expect((await secondary.listPages()).size).toBe(1);
  expect((await secondary.readPage("start")).text).toBe("Hello");
  let lastSync = sync.lastSync;

  // Should be a no-op
  await sync.syncPages();
  expect(sync.lastSync).toBe(lastSync);

  // Now let's make a change on the secondary
  await secondary.writePage("start", "Hello!!");
  await secondary.writePage("test", "Test page");

  // And sync it
  await sync.syncPages();

  expect((await primary.listPages()).size).toBe(2);
  expect((await secondary.listPages()).size).toBe(2);

  expect((await primary.readPage("start")).text).toBe("Hello!!");

  // Let's make some random edits on both ends
  await primary.writePage("start", "1");
  await primary.writePage("start2", "2");
  await secondary.writePage("start3", "3");
  await secondary.writePage("start4", "4");
  await sync.syncPages();

  expect((await primary.listPages()).size).toBe(5);
  expect((await secondary.listPages()).size).toBe(5);

  expect(await sync.syncPages()).toBe(0);

  console.log("Deleting pages");
  // Delete some pages
  await primary.deletePage("start");
  await primary.deletePage("start3");

  console.log("Pages", await primary.listPages());
  console.log("Trash", await primary.listTrash());

  await sync.syncPages();

  expect((await primary.listPages()).size).toBe(3);
  expect((await secondary.listPages()).size).toBe(3);

  // No-op
  expect(await sync.syncPages()).toBe(0);

  await secondary.deletePage("start4");
  await primary.deletePage("start2");

  await sync.syncPages();

  // Just "test" left
  expect((await primary.listPages()).size).toBe(1);
  expect((await secondary.listPages()).size).toBe(1);

  // No-op
  expect(await sync.syncPages()).toBe(0);

  await secondary.writePage("start", "I'm back");

  await sync.syncPages();

  expect((await primary.readPage("start")).text).toBe("I'm back");

  // Cause a conflict
  await primary.writePage("start", "Hello 1");
  await secondary.writePage("start", "Hello 2");

  await sync.syncPages(SpaceSync.primaryConflictResolver(primary, secondary));

  // Sync conflicting copy back
  await sync.syncPages();

  // Verify that primary won
  expect((await primary.readPage("start")).text).toBe("Hello 1");
  expect((await secondary.readPage("start")).text).toBe("Hello 1");

  // test + start + start.conflicting copy
  expect((await primary.listPages()).size).toBe(3);
  expect((await secondary.listPages()).size).toBe(3);
});
