import { SpaceSync, SyncStatusItem } from "./sync.ts";
import { DiskSpacePrimitives } from "./disk_space_primitives.ts";
import { assertEquals } from "../../test_deps.ts";

Deno.test("Test store", async () => {
  const skew = 1000 * 60 * 60 * 24 * 7;

  const primaryPath = await Deno.makeTempDir();
  const secondaryPath = await Deno.makeTempDir();
  console.log("Primary", primaryPath);
  console.log("Secondary", secondaryPath);
  const primary = new DiskSpacePrimitives(primaryPath);
  const secondary = new DiskSpacePrimitives(secondaryPath);
  const statusMap = new Map<string, SyncStatusItem>();
  const sync = new SpaceSync(primary, secondary, statusMap);

  // Write one page to primary
  await primary.writeFile("index", "string", "Hello");
  assertEquals((await secondary.fetchFileList()).files.length, 0);
  console.log("Initial sync ops", await doSync());

  assertEquals((await secondary.fetchFileList()).files.length, 1);
  assertEquals((await secondary.readFile("index", "string")).data, "Hello");

  // Should be a no-op
  assertEquals(await doSync(), 0);

  // Now let's make a change on the secondary
  await secondary.writeFile("index", "string", "Hello!!");
  await secondary.writeFile("test", "string", "Test page");

  // And sync it
  await doSync();

  assertEquals((await primary.fetchFileList()).files.length, 2);
  assertEquals((await secondary.fetchFileList()).files.length, 2);

  assertEquals((await primary.readFile("index", "string")).data, "Hello!!");

  // Let's make some random edits on both ends
  await primary.writeFile("index", "string", "1");
  await primary.writeFile("index2", "string", "2");
  await secondary.writeFile("index3", "string", "3");
  await secondary.writeFile("index4", "string", "4");
  await doSync();

  assertEquals((await primary.fetchFileList()).files.length, 5);
  assertEquals((await secondary.fetchFileList()).files.length, 5);

  assertEquals(await doSync(), 0);

  console.log("Deleting pages");
  // Delete some pages
  await primary.deleteFile("index");
  await primary.deleteFile("index3");

  await doSync();

  assertEquals((await primary.fetchFileList()).files.length, 3);
  assertEquals((await secondary.fetchFileList()).files.length, 3);

  // No-op
  assertEquals(await doSync(), 0);

  await secondary.deleteFile("index4");
  await primary.deleteFile("index2");

  await doSync();

  // Just "test" left
  assertEquals((await primary.fetchFileList()).files.length, 1);
  assertEquals((await secondary.fetchFileList()).files.length, 1);

  // No-op
  assertEquals(await doSync(), 0);

  await secondary.writeFile("index", "string", "I'm back");

  await doSync();

  assertEquals((await primary.readFile("index", "string")).data, "I'm back");

  // Cause a conflict
  console.log("Introducing a conflict now");
  await primary.writeFile("index", "string", "Hello 1");
  await secondary.writeFile("index", "string", "Hello 2");

  await doSync();

  // Sync conflicting copy back
  await doSync();

  // Verify that primary won
  assertEquals((await primary.readFile("index", "string")).data, "Hello 1");
  assertEquals((await secondary.readFile("index", "string")).data, "Hello 1");

  // test + index + index.conflicting copy
  assertEquals((await primary.fetchFileList()).files.length, 3);
  assertEquals((await secondary.fetchFileList()).files.length, 3);

  console.log("Bringing a third device in the mix");

  const ternaryPath = await Deno.makeTempDir();

  console.log("Ternary", ternaryPath);

  const ternary = new DiskSpacePrimitives(ternaryPath);
  const sync2 = new SpaceSync(
    secondary,
    ternary,
    new Map<string, SyncStatusItem>(),
  );
  console.log("N ops", await sync2.syncFiles());
  await sleep(2);
  assertEquals(await sync2.syncFiles(), 0);

  await Deno.remove(primaryPath, { recursive: true });
  await Deno.remove(secondaryPath, { recursive: true });
  await Deno.remove(ternaryPath, { recursive: true });

  async function doSync() {
    await sleep(2);
    const r = await sync.syncFiles(
      SpaceSync.primaryConflictResolver,
    );
    await sleep(2);
    return r;
  }
});

function sleep(ms = 5): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
