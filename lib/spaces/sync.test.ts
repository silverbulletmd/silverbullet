import { SpaceSync, SyncSnapshot } from "./sync.ts";
import { DiskSpacePrimitives } from "./disk_space_primitives.ts";
import { assertEquals } from "@std/assert";
import { sleep } from "../async.ts";
import { assert } from "node:console";

Deno.test("Test sync with no filtering", async () => {
  const primaryPath = await Deno.makeTempDir();
  const secondaryPath = await Deno.makeTempDir();
  console.log("Primary", primaryPath);
  console.log("Secondary", secondaryPath);
  const primary = new DiskSpacePrimitives(primaryPath);
  const secondary = new DiskSpacePrimitives(secondaryPath);
  const snapshot = new SyncSnapshot();
  const sync = new SpaceSync(primary, secondary, {
    conflictResolver: SpaceSync.primaryConflictResolver,
    isSyncCandidate: () => true, // Sync everything always
  });

  console.log("Write one page to primary");
  await primary.writeFile("index.md", stringToBytes("Hello"));
  assertEquals((await secondary.fetchFileList()).length, 0);
  console.log("Initial sync ops", await doSync());

  assertEquals((await secondary.fetchFileList()).length, 1);
  assertEquals(
    (await secondary.readFile("index.md")).data,
    stringToBytes("Hello"),
  );

  // Should be a no-op
  let ops = await doSync();
  assertEquals(ops, 0);
  assertEquals(snapshot.nonSyncedFiles.size, 0);

  // Now let's make a change on the secondary
  await secondary.writeFile("index.md", stringToBytes("Hello!!"));
  await secondary.writeFile("test.md", stringToBytes("Test page"));

  // And sync it
  ops = await doSync();
  assertEquals(ops, 2);
  assertEquals(snapshot.nonSyncedFiles.size, 0);

  assertEquals((await primary.fetchFileList()).length, 2);
  assertEquals((await secondary.fetchFileList()).length, 2);

  assertEquals(
    (await primary.readFile("index.md")).data,
    stringToBytes("Hello!!"),
  );

  // Let's make some random edits on both ends
  await primary.writeFile("index.md", stringToBytes("1"));
  await primary.writeFile("index2.md", stringToBytes("2"));
  await secondary.writeFile("index3.md", stringToBytes("3"));
  await secondary.writeFile("index4.md", stringToBytes("4"));
  await doSync();

  assertEquals((await primary.fetchFileList()).length, 5);
  assertEquals((await secondary.fetchFileList()).length, 5);

  ops = await doSync();
  assertEquals(ops, 0);

  console.log("Deleting pages");
  // Delete some pages
  await primary.deleteFile("index.md");
  await primary.deleteFile("index3.md");

  await doSync();

  assertEquals((await primary.fetchFileList()).length, 3);
  assertEquals((await secondary.fetchFileList()).length, 3);

  // No-op
  ops = await doSync();
  assertEquals(ops, 0);

  await secondary.deleteFile("index4.md");
  await primary.deleteFile("index2.md");

  await doSync();

  // Just "test" left
  assertEquals((await primary.fetchFileList()).length, 1);
  assertEquals((await secondary.fetchFileList()).length, 1);

  // No-op
  ops = await doSync();
  assertEquals(ops, 0);

  await secondary.writeFile("index.md", stringToBytes("I'm back"));

  await doSync();

  assertEquals(
    (await primary.readFile("index.md")).data,
    stringToBytes("I'm back"),
  );

  // Cause a conflict
  console.log("Introducing a conflict now");
  await primary.writeFile("index.md", stringToBytes("Hello 1"));
  await secondary.writeFile("index.md", stringToBytes("Hello 2"));

  await doSync();

  // Sync conflicting copy back
  await doSync();

  // Verify that primary won
  assertEquals(
    (await primary.readFile("index.md")).data,
    stringToBytes("Hello 1"),
  );
  assertEquals(
    (await secondary.readFile("index.md")).data,
    stringToBytes("Hello 1"),
  );

  // test + index + index.conflicting copy
  assertEquals((await primary.fetchFileList()).length, 3);
  assertEquals((await secondary.fetchFileList()).length, 3);

  // Introducing a fake conflict (same content, so not really conflicting)
  await primary.writeFile("index.md", stringToBytes("Hello 1"));
  await secondary.writeFile("index.md", stringToBytes("Hello 1"));

  await doSync();
  await doSync();

  // test + index + index.md + previous index.conflicting copy but nothing more
  assertEquals((await primary.fetchFileList()).length, 3);

  await Deno.remove(primaryPath, { recursive: true });
  await Deno.remove(secondaryPath, { recursive: true });

  async function doSync() {
    await sleep(10);
    const r = await sync.syncFiles(snapshot);
    await sleep(10);
    return r;
  }
});

Deno.test("Test sync with filtering", async () => {
  const primaryPath = await Deno.makeTempDir();
  const secondaryPath = await Deno.makeTempDir();
  console.log("Primary", primaryPath);
  console.log("Secondary", secondaryPath);
  const primary = new DiskSpacePrimitives(primaryPath);
  const secondary = new DiskSpacePrimitives(secondaryPath);

  const snapshot = new SyncSnapshot();
  let sync = new SpaceSync(
    primary,
    secondary,
    {
      conflictResolver: SpaceSync.primaryConflictResolver,
      isSyncCandidate: (path) => path.endsWith(".md"), // Only sync .md files
    },
  );

  console.log(
    "Write one non-sync file on the primary, which SHOULD sync to the secondary",
  );
  await primary.writeFile("index.txt", stringToBytes("Hello"));
  assertEquals((await secondary.fetchFileList()).length, 0);
  let ops = await doSync();
  assertEquals(ops, 1);
  // Note: this number should be 0 because the file DOES have a local representation so it's not technically non-synced
  assertEquals(snapshot.nonSyncedFiles.size, 0);

  assertEquals((await secondary.fetchFileList()).length, 1);
  assertEquals(
    (await secondary.readFile("index.txt")).data,
    stringToBytes("Hello"),
  );

  console.log("Updating on secondary");
  await secondary.writeFile("index.txt", stringToBytes("Hello Updated"));
  ops = await doSync();
  assertEquals(ops, 1);
  assertEquals(snapshot.nonSyncedFiles.size, 1);
  try {
    await primary.getFileMeta("index.md");
    assert(
      false,
      "Local file should have been deleted locally since it's out of date",
    );
  } catch {
    // Expected
  }

  console.log("Deleting remote files");
  await secondary.deleteFile("index.txt");
  ops = await doSync();
  assertEquals(ops, 1);
  assertEquals(snapshot.nonSyncedFiles.size, 0);

  console.log("Creating a remote non-synced file");
  await secondary.writeFile("index2.txt", stringToBytes("Hello 2"));
  ops = await doSync();
  assertEquals(ops, 0); // No-op, metadata only
  assertEquals(snapshot.nonSyncedFiles.size, 1);
  ops = await doSync();
  assertEquals(ops, 0); // No-op, metadata only
  assertEquals(snapshot.nonSyncedFiles.size, 1);

  await primary.writeFile("index2.txt", stringToBytes("Hello local"));
  ops = await doSync();
  assertEquals(ops, 1);
  assertEquals(snapshot.nonSyncedFiles.size, 0);

  console.log("Getting into a state with some synced and non-synced files");
  await secondary.writeFile("index.md", stringToBytes("This will sync"));
  await secondary.writeFile("index.txt", stringToBytes("This will not sync"));
  await secondary.writeFile("index2.txt", stringToBytes("This will not sync"));
  ops = await doSync();
  assertEquals(ops, 2);
  assertEquals(snapshot.nonSyncedFiles.size, 2);

  // Check file listings on both ends
  assertEquals((await secondary.fetchFileList()).length, 3);
  assertEquals((await primary.fetchFileList()).length, 1);

  ////////////
  // Now let's start another sync session, but now wanting to sync everything
  console.log("Going to switch to syncing everything now");
  sync = new SpaceSync(
    primary,
    secondary,
    {
      conflictResolver: SpaceSync.primaryConflictResolver,
      isSyncCandidate: () => true,
    },
  );

  ops = await doSync();
  // This should pull 2 files from remote to local
  assertEquals(ops, 2);
  assertEquals((await primary.fetchFileList()).length, 3);
  assertEquals((await secondary.fetchFileList()).length, 3);

  console.log("And now to syncing nothing");
  sync = new SpaceSync(
    primary,
    secondary,
    {
      conflictResolver: SpaceSync.primaryConflictResolver,
      isSyncCandidate: () => false,
    },
  );

  ops = await doSync();
  // This should delete 3 files from the primary
  assertEquals(ops, 3);
  // Leaving nothing on primary
  assertEquals((await primary.fetchFileList()).length, 0);
  // And everything unchanged on secondary
  assertEquals((await secondary.fetchFileList()).length, 3);

  await Deno.remove(primaryPath, { recursive: true });
  await Deno.remove(secondaryPath, { recursive: true });

  async function doSync() {
    await sleep(10);
    const r = await sync.syncFiles(snapshot);
    return r;
  }
});

Deno.test("Local push sync", async () => {
  const primaryPath = await Deno.makeTempDir();
  const secondaryPath = await Deno.makeTempDir();
  console.log("Primary", primaryPath);
  console.log("Secondary", secondaryPath);
  const primary = new DiskSpacePrimitives(primaryPath);
  const secondary = new DiskSpacePrimitives(secondaryPath);
  const snapshot = new SyncSnapshot();
  const sync = new SpaceSync(primary, secondary, {
    conflictResolver: SpaceSync.primaryConflictResolver,
    isSyncCandidate: (path) => path.endsWith(".md"), // Only sync .md files
  });

  console.log(
    "Write one non-sync file on the primary, which SHOULD sync to the secondary",
  );

  const operations = await sync.syncFiles(snapshot);
  assertEquals(operations, 0);

  await primary.writeFile("index.md", stringToBytes("Hello"));
  assertEquals(1, await sync.syncSingleFile("index.md", snapshot));

  assertEquals(
    (await secondary.readFile("index.md")).data,
    stringToBytes("Hello"),
  );

  console.log("Let's write a new file on primary that is not a sync candidate");
  await primary.writeFile("test.txt", stringToBytes("Hello"));
  assertEquals(1, await sync.syncSingleFile("test.txt", snapshot));
  assertEquals(snapshot.nonSyncedFiles.size, 0);

  await Deno.remove(primaryPath, { recursive: true });
  await Deno.remove(secondaryPath, { recursive: true });
});

function stringToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
