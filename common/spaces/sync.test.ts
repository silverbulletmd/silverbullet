import { SpaceSync } from "./sync.ts";
import { FileMeta } from "../types.ts";
import { DiskSpacePrimitives } from "./disk_space_primitives.ts";
import { TrashSpacePrimitives } from "./trash_space_primitives.ts";
import { assertEquals } from "../../test_deps.ts";

Deno.test("Test store", async () => {
  const skew = 1000 * 60 * 60 * 24 * 7;

  const primaryPath = await Deno.makeTempDir();
  const secondaryPath = await Deno.makeTempDir();
  console.log("Primary", primaryPath);
  console.log("Secondary", secondaryPath);
  const primary = new TrashSpacePrimitives(
    new DiskSpacePrimitives(primaryPath),
    "_trash/",
    skew,
  );
  const secondary = new TrashSpacePrimitives(
    new DiskSpacePrimitives(secondaryPath),
    "_trash/",
  );
  const sync = new SpaceSync(primary, secondary, 0, 0);

  async function conflictResolver(_fm1: FileMeta, _fm2: FileMeta) {}

  // Write one page to primary
  await primary.writeFile("index", "string", "Hello");
  assertEquals((await secondary.seggregateFileList()).files.length, 0);
  await syncFiles(conflictResolver);
  assertEquals((await secondary.seggregateFileList()).files.length, 1);
  assertEquals((await secondary.readFile("index", "string")).data, "Hello");

  // Should be a no-op
  assertEquals(await syncFiles(), 0);

  // Now let's make a change on the secondary
  await secondary.writeFile("index", "string", "Hello!!");
  await secondary.writeFile("test", "string", "Test page");

  // And sync it
  await syncFiles();

  assertEquals((await primary.seggregateFileList()).files.length, 2);
  assertEquals((await secondary.seggregateFileList()).files.length, 2);

  assertEquals((await primary.readFile("index", "string")).data, "Hello!!");

  // Let's make some random edits on both ends
  await primary.writeFile("index", "string", "1");
  await primary.writeFile("index2", "string", "2");
  await secondary.writeFile("index3", "string", "3");
  await secondary.writeFile("index4", "string", "4");
  await syncFiles();

  assertEquals((await primary.seggregateFileList()).files.length, 5);
  assertEquals((await secondary.seggregateFileList()).files.length, 5);

  assertEquals(await syncFiles(), 0);

  console.log("Deleting pages");
  // Delete some pages
  await primary.deleteFile("index");
  await primary.deleteFile("index3");

  const { files, trashFiles } = await primary.seggregateFileList();
  console.log("Pages", files);
  console.log("Trash", trashFiles);

  await syncFiles();

  assertEquals((await primary.seggregateFileList()).files.length, 3);
  assertEquals((await secondary.seggregateFileList()).files.length, 3);

  // No-op
  assertEquals(await syncFiles(), 0);

  await secondary.deleteFile("index4");
  await primary.deleteFile("index2");

  await syncFiles();

  // Just "test" left
  assertEquals((await primary.seggregateFileList()).files.length, 1);
  assertEquals((await secondary.seggregateFileList()).files.length, 1);

  // No-op
  assertEquals(await syncFiles(), 0);

  await secondary.writeFile("index", "string", "I'm back");

  await syncFiles();

  assertEquals((await primary.readFile("index", "string")).data, "I'm back");

  // Cause a conflict
  await primary.writeFile("index", "string", "Hello 1");
  await secondary.writeFile("index", "string", "Hello 2");

  await syncFiles(SpaceSync.primaryConflictResolver(primary, secondary));

  // Sync conflicting copy back
  await syncFiles();

  // Verify that primary won
  assertEquals((await primary.readFile("index", "string")).data, "Hello 1");
  assertEquals((await secondary.readFile("index", "string")).data, "Hello 1");

  // test + index + index.conflicting copy
  assertEquals((await primary.seggregateFileList()).files.length, 3);
  assertEquals((await secondary.seggregateFileList()).files.length, 3);

  await Deno.remove(primaryPath, { recursive: true });
  await Deno.remove(secondaryPath, { recursive: true });

  async function syncFiles(
    conflictResolver?: (
      fileMeta1: FileMeta,
      fileMeta2: FileMeta,
    ) => Promise<void>,
  ): Promise<number> {
    // Awesome practice: adding sleeps to fix issues!
    await sleep(2);
    let n = await sync.syncFiles(conflictResolver);
    await sleep(2);
    return n;
  }
});

function sleep(ms = 5): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
