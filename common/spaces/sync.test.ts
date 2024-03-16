import { SpaceSync, SyncStatusItem } from "./sync.ts";
import { DiskSpacePrimitives } from "./disk_space_primitives.ts";
import { assertEquals } from "$std/testing/asserts.ts";

Deno.test("Test store", async () => {
  const primaryPath = await Deno.makeTempDir();
  const secondaryPath = await Deno.makeTempDir();
  console.log("Primary", primaryPath);
  console.log("Secondary", secondaryPath);
  const primary = new DiskSpacePrimitives(primaryPath);
  const secondary = new DiskSpacePrimitives(secondaryPath);
  const snapshot = new Map<string, SyncStatusItem>();
  const sync = new SpaceSync(primary, secondary, {
    conflictResolver: SpaceSync.primaryConflictResolver,
  });

  // Write one page to primary
  await primary.writeFile("index", stringToBytes("Hello"));
  assertEquals((await secondary.fetchFileList()).length, 0);
  console.log("Initial sync ops", await doSync());

  assertEquals((await secondary.fetchFileList()).length, 1);
  assertEquals(
    (await secondary.readFile("index")).data,
    stringToBytes("Hello"),
  );

  // Should be a no-op
  assertEquals(await doSync(), 0);

  // Now let's make a change on the secondary
  await secondary.writeFile("index", stringToBytes("Hello!!"));
  await secondary.writeFile("test", stringToBytes("Test page"));

  // And sync it
  await doSync();

  assertEquals((await primary.fetchFileList()).length, 2);
  assertEquals((await secondary.fetchFileList()).length, 2);

  assertEquals(
    (await primary.readFile("index")).data,
    stringToBytes("Hello!!"),
  );

  // Let's make some random edits on both ends
  await primary.writeFile("index", stringToBytes("1"));
  await primary.writeFile("index2", stringToBytes("2"));
  await secondary.writeFile("index3", stringToBytes("3"));
  await secondary.writeFile("index4", stringToBytes("4"));
  await doSync();

  assertEquals((await primary.fetchFileList()).length, 5);
  assertEquals((await secondary.fetchFileList()).length, 5);

  assertEquals(await doSync(), 0);

  console.log("Deleting pages");
  // Delete some pages
  await primary.deleteFile("index");
  await primary.deleteFile("index3");

  await doSync();

  assertEquals((await primary.fetchFileList()).length, 3);
  assertEquals((await secondary.fetchFileList()).length, 3);

  // No-op
  assertEquals(await doSync(), 0);

  await secondary.deleteFile("index4");
  await primary.deleteFile("index2");

  await doSync();

  // Just "test" left
  assertEquals((await primary.fetchFileList()).length, 1);
  assertEquals((await secondary.fetchFileList()).length, 1);

  // No-op
  assertEquals(await doSync(), 0);

  await secondary.writeFile("index", stringToBytes("I'm back"));

  await doSync();

  assertEquals(
    (await primary.readFile("index")).data,
    stringToBytes("I'm back"),
  );

  // Cause a conflict
  console.log("Introducing a conflict now");
  await primary.writeFile("index", stringToBytes("Hello 1"));
  await secondary.writeFile("index", stringToBytes("Hello 2"));

  await doSync();

  // Sync conflicting copy back
  await doSync();

  // Verify that primary won
  assertEquals(
    (await primary.readFile("index")).data,
    stringToBytes("Hello 1"),
  );
  assertEquals(
    (await secondary.readFile("index")).data,
    stringToBytes("Hello 1"),
  );

  // test + index + index.conflicting copy
  assertEquals((await primary.fetchFileList()).length, 3);
  assertEquals((await secondary.fetchFileList()).length, 3);

  // Introducing a fake conflict (same content, so not really conflicting)
  await primary.writeFile("index", stringToBytes("Hello 1"));
  await secondary.writeFile("index", stringToBytes("Hello 1"));

  await doSync();
  await doSync();

  // test + index + index.md + previous index.conflicting copy but nothing more
  assertEquals((await primary.fetchFileList()).length, 3);

  console.log("Bringing a third device in the mix");

  const ternaryPath = await Deno.makeTempDir();

  console.log("Ternary", ternaryPath);

  const ternary = new DiskSpacePrimitives(ternaryPath);
  const sync2 = new SpaceSync(
    secondary,
    ternary,
    {
      conflictResolver: SpaceSync.primaryConflictResolver,
    },
  );
  const snapshot2 = new Map<string, SyncStatusItem>();
  console.log(
    "N ops",
    await sync2.syncFiles(snapshot2),
  );
  await sleep(2);
  assertEquals(await sync2.syncFiles(snapshot2), 0);

  // I had to look up what follows ternary (https://english.stackexchange.com/questions/25116/what-follows-next-in-the-sequence-unary-binary-ternary)
  const quaternaryPath = await Deno.makeTempDir();
  const quaternary = new DiskSpacePrimitives(quaternaryPath);
  const sync3 = new SpaceSync(
    secondary,
    quaternary,
    {
      isSyncCandidate: (path) => !path.startsWith("index"),
      conflictResolver: SpaceSync.primaryConflictResolver,
    },
  );
  const selectingOps = await sync3.syncFiles(new Map());

  assertEquals(selectingOps, 1);

  await Deno.remove(primaryPath, { recursive: true });
  await Deno.remove(secondaryPath, { recursive: true });
  await Deno.remove(ternaryPath, { recursive: true });
  await Deno.remove(quaternaryPath, { recursive: true });

  async function doSync() {
    await sleep();
    const r = await sync.syncFiles(snapshot);
    await sleep();
    return r;
  }
});

function sleep(ms = 10): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function stringToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
