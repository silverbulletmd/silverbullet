import { expect, test } from "@jest/globals";
import { IndexedDBSpace } from "./indexeddb_space";
import { SpaceSync } from "./sync";

// For testing in node.js
require("fake-indexeddb/auto");

test("Test store", async () => {
  let primary = new IndexedDBSpace("primary");
  let secondary = new IndexedDBSpace("secondary");
  let sync = new SpaceSync(primary, secondary, 0);

  // Write one page to primary
  await primary.writePage("start", "Hello");
  expect((await secondary.listPages()).size).toBe(0);
  await sync.syncPages();
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

  console.log("Should be no op");
  await sync.syncPages();

  console.log("Done");

  // Cause a conflict
  await primary.writePage("start", "Hello 1");
  await secondary.writePage("start", "Hello 2");

  try {
    await sync.syncPages();
    // This should throw a sync conflict, so cannot be here
    expect(false).toBe(true);
  } catch {}
});
