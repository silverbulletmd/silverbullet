import { expect, test } from "vitest";
import { SpaceSync, SyncSnapshot } from "./sync.ts";
import { sleep } from "@silverbulletmd/silverbullet/lib/async";
import { assert } from "node:console";
import { MemoryKvPrimitives } from "../data/memory_kv_primitives.ts";
import { DataStoreSpacePrimitives } from "./datastore_space_primitives.ts";

test("Test sync with no filtering", async () => {
  const primary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
  const secondary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
  const snapshot = new SyncSnapshot();
  const sync = new SpaceSync(primary, secondary, {
    conflictResolver: SpaceSync.primaryConflictResolver,
    isSyncCandidate: () => true, // Sync everything always
  });

  console.log("Write one page to primary");
  await primary.writeFile("index.md", stringToBytes("Hello"));
  expect((await secondary.fetchFileList()).length).toEqual(0);
  console.log("Initial sync ops", await doSync());

  expect((await secondary.fetchFileList()).length).toEqual(1);
  expect((await secondary.readFile("index.md")).data).toEqual(stringToBytes("Hello"),
  );

  // Should be a no-op
  let ops = await doSync();
  expect(ops).toEqual(0);
  expect(snapshot.nonSyncedFiles.size).toEqual(0);

  // Now let's make a change on the secondary
  await secondary.writeFile("index.md", stringToBytes("Hello!!"));
  await secondary.writeFile("test.md", stringToBytes("Test page"));

  // And sync it
  ops = await doSync();
  expect(ops).toEqual(2);
  expect(snapshot.nonSyncedFiles.size).toEqual(0);

  expect((await primary.fetchFileList()).length).toEqual(2);
  expect((await secondary.fetchFileList()).length).toEqual(2);

  expect((await primary.readFile("index.md")).data).toEqual(stringToBytes("Hello!!"),
  );

  // Let's make some random edits on both ends
  await primary.writeFile("index.md", stringToBytes("1"));
  await primary.writeFile("index2.md", stringToBytes("2"));
  await secondary.writeFile("index3.md", stringToBytes("3"));
  await secondary.writeFile("index4.md", stringToBytes("4"));
  await doSync();

  expect((await primary.fetchFileList()).length).toEqual(5);
  expect((await secondary.fetchFileList()).length).toEqual(5);

  ops = await doSync();
  expect(ops).toEqual(0);

  console.log("Deleting pages");
  // Delete some pages
  await primary.deleteFile("index.md");
  await primary.deleteFile("index3.md");

  await doSync();

  expect((await primary.fetchFileList()).length).toEqual(3);
  expect((await secondary.fetchFileList()).length).toEqual(3);

  // No-op
  ops = await doSync();
  expect(ops).toEqual(0);

  await secondary.deleteFile("index4.md");
  await primary.deleteFile("index2.md");

  await doSync();

  // Just "test" left
  expect((await primary.fetchFileList()).length).toEqual(1);
  expect((await secondary.fetchFileList()).length).toEqual(1);

  // No-op
  ops = await doSync();
  expect(ops).toEqual(0);

  await secondary.writeFile("index.md", stringToBytes("I'm back"));

  await doSync();

  expect((await primary.readFile("index.md")).data).toEqual(stringToBytes("I'm back"),
  );

  // Cause a conflict
  console.log("Introducing a conflict now");
  await primary.writeFile("index.md", stringToBytes("Hello 1"));
  await secondary.writeFile("index.md", stringToBytes("Hello 2"));

  await doSync();

  // Sync conflicting copy back
  await doSync();

  // Verify that primary won
  expect((await primary.readFile("index.md")).data).toEqual(stringToBytes("Hello 1"),
  );
  expect((await secondary.readFile("index.md")).data).toEqual(stringToBytes("Hello 1"),
  );

  // test + index + index.conflicting copy
  expect((await primary.fetchFileList()).length).toEqual(3);
  expect((await secondary.fetchFileList()).length).toEqual(3);

  // Introducing a fake conflict (same content, so not really conflicting)
  await primary.writeFile("index.md", stringToBytes("Hello 1"));
  await secondary.writeFile("index.md", stringToBytes("Hello 1"));

  await doSync();
  await doSync();

  // test + index + index.md + previous index.conflicting copy but nothing more
  expect((await primary.fetchFileList()).length).toEqual(3);

  async function doSync() {
    await sleep(10);
    const r = await sync.syncFiles(snapshot);
    await sleep(10);
    return r;
  }
});

test("Test sync with filtering", async () => {
  const primary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
  const secondary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());

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
  expect((await secondary.fetchFileList()).length).toEqual(0);
  let ops = await doSync();
  expect(ops).toEqual(1);
  // Note: this number should be 0 because the file DOES have a local representation so it's not technically non-synced
  expect(snapshot.nonSyncedFiles.size).toEqual(0);

  expect((await secondary.fetchFileList()).length).toEqual(1);
  expect((await secondary.readFile("index.txt")).data).toEqual(stringToBytes("Hello"),
  );

  console.log("Updating on secondary");
  await secondary.writeFile("index.txt", stringToBytes("Hello Updated"));
  ops = await doSync();
  expect(ops).toEqual(1);
  expect(snapshot.nonSyncedFiles.size).toEqual(1);
  try {
    await primary.getFileMeta("index.md");
    expect(
      false,
      "Local file should have been deleted locally since it's out of date",
    ).toBeTruthy();
  } catch {
    // Expected
  }

  console.log("Deleting remote files");
  await secondary.deleteFile("index.txt");
  ops = await doSync();
  expect(ops).toEqual(1);
  expect(snapshot.nonSyncedFiles.size).toEqual(0);

  console.log("Creating a remote non-synced file");
  await secondary.writeFile("index2.txt", stringToBytes("Hello 2"));
  ops = await doSync();
  expect(ops).toEqual(0); // No-op, metadata only
  expect(snapshot.nonSyncedFiles.size).toEqual(1);
  ops = await doSync();
  expect(ops).toEqual(0); // No-op, metadata only
  expect(snapshot.nonSyncedFiles.size).toEqual(1);

  await primary.writeFile("index2.txt", stringToBytes("Hello local"));
  ops = await doSync();
  expect(ops).toEqual(1);
  expect(snapshot.nonSyncedFiles.size).toEqual(0);

  console.log("Getting into a state with some synced and non-synced files");
  await secondary.writeFile("index.md", stringToBytes("This will sync"));
  await secondary.writeFile("index.txt", stringToBytes("This will not sync"));
  await secondary.writeFile("index2.txt", stringToBytes("This will not sync"));
  ops = await doSync();
  expect(ops).toEqual(2);
  expect(snapshot.nonSyncedFiles.size).toEqual(2);

  // Check file listings on both ends
  expect((await secondary.fetchFileList()).length).toEqual(3);
  expect((await primary.fetchFileList()).length).toEqual(1);

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
  expect(ops).toEqual(2);
  expect((await primary.fetchFileList()).length).toEqual(3);
  expect((await secondary.fetchFileList()).length).toEqual(3);

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
  expect(ops).toEqual(3);
  // Leaving nothing on primary
  expect((await primary.fetchFileList()).length).toEqual(0);
  // And everything unchanged on secondary
  expect((await secondary.fetchFileList()).length).toEqual(3);

  // Ok, now we're going to sync everything again
  sync = new SpaceSync(
    primary,
    secondary,
    {
      conflictResolver: SpaceSync.primaryConflictResolver,
      isSyncCandidate: () => true,
    },
  );
  // await secondary.
  ops = await doSync();
  expect(ops).toEqual(3);
  expect((await primary.fetchFileList()).length).toEqual(3);
  expect((await secondary.fetchFileList()).length).toEqual(3);

  async function doSync() {
    await sleep(10);
    const r = await sync.syncFiles(snapshot);
    return r;
  }
});

test("Local push sync", async () => {
  const primary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
  const secondary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
  const snapshot = new SyncSnapshot();
  const sync = new SpaceSync(primary, secondary, {
    conflictResolver: SpaceSync.primaryConflictResolver,
    isSyncCandidate: (path) => path.endsWith(".md"), // Only sync .md files
  });

  console.log(
    "Write one non-sync file on the primary, which SHOULD sync to the secondary",
  );

  const operations = await sync.syncFiles(snapshot);
  expect(operations).toEqual(0);

  await primary.writeFile("index.md", stringToBytes("Hello"));
  expect(1).toEqual(await sync.syncSingleFile("index.md", snapshot));

  expect((await secondary.readFile("index.md")).data).toEqual(stringToBytes("Hello"),
  );

  console.log("Let's write a new file on primary that is not a sync candidate");
  await primary.writeFile("test.txt", stringToBytes("Hello"));
  expect(1).toEqual(await sync.syncSingleFile("test.txt", snapshot));
  expect(snapshot.nonSyncedFiles.size).toEqual(0);
});

function stringToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
