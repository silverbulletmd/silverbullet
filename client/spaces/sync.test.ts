import { describe, expect, test } from "vitest";
import { SpaceSync, SyncSnapshot } from "./sync.ts";
import { sleep } from "@silverbulletmd/silverbullet/lib/async";
import { MemoryKvPrimitives } from "../data/memory_kv_primitives.ts";
import { DataStoreSpacePrimitives } from "./datastore_space_primitives.ts";

const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

function createSyncSetup(opts?: {
  isSyncCandidate?: (path: string) => boolean;
}) {
  const primary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
  const secondary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
  const snapshot = new SyncSnapshot();
  const sync = new SpaceSync(primary, secondary, {
    conflictResolver: SpaceSync.primaryConflictResolver,
    isSyncCandidate: opts?.isSyncCandidate ?? (() => true),
  });
  return { primary, secondary, snapshot, sync };
}

async function doSync(
  sync: SpaceSync,
  snapshot: SyncSnapshot,
): Promise<number> {
  await sleep(10);
  return sync.syncFiles(snapshot);
}

describe("Sync with no filtering", () => {
  test("bidirectional create, update, delete, conflict", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();

    console.log("Write one page to primary");
    await primary.writeFile("index.md", encode("Hello"));
    expect((await secondary.fetchFileList()).length).toEqual(0);
    console.log("Initial sync ops", await doSync(sync, snapshot));

    expect((await secondary.fetchFileList()).length).toEqual(1);
    expect((await secondary.readFile("index.md")).data).toEqual(
      encode("Hello"),
    );

    // Should be a no-op
    let ops = await doSync(sync, snapshot);
    expect(ops).toEqual(0);
    expect(snapshot.nonSyncedFiles.size).toEqual(0);

    // Now let's make a change on the secondary
    await secondary.writeFile("index.md", encode("Hello!!"));
    await secondary.writeFile("test.md", encode("Test page"));

    // And sync it
    ops = await doSync(sync, snapshot);
    expect(ops).toEqual(2);
    expect(snapshot.nonSyncedFiles.size).toEqual(0);

    expect((await primary.fetchFileList()).length).toEqual(2);
    expect((await secondary.fetchFileList()).length).toEqual(2);

    expect((await primary.readFile("index.md")).data).toEqual(
      encode("Hello!!"),
    );

    // Let's make some random edits on both ends
    await primary.writeFile("index.md", encode("1"));
    await primary.writeFile("index2.md", encode("2"));
    await secondary.writeFile("index3.md", encode("3"));
    await secondary.writeFile("index4.md", encode("4"));
    await doSync(sync, snapshot);

    expect((await primary.fetchFileList()).length).toEqual(5);
    expect((await secondary.fetchFileList()).length).toEqual(5);

    ops = await doSync(sync, snapshot);
    expect(ops).toEqual(0);

    console.log("Deleting pages");
    // Delete some pages
    await primary.deleteFile("index.md");
    await primary.deleteFile("index3.md");

    await doSync(sync, snapshot);

    expect((await primary.fetchFileList()).length).toEqual(3);
    expect((await secondary.fetchFileList()).length).toEqual(3);

    // No-op
    ops = await doSync(sync, snapshot);
    expect(ops).toEqual(0);

    await secondary.deleteFile("index4.md");
    await primary.deleteFile("index2.md");

    await doSync(sync, snapshot);

    // Just "test" left
    expect((await primary.fetchFileList()).length).toEqual(1);
    expect((await secondary.fetchFileList()).length).toEqual(1);

    // No-op
    ops = await doSync(sync, snapshot);
    expect(ops).toEqual(0);

    await secondary.writeFile("index.md", encode("I'm back"));

    await doSync(sync, snapshot);

    expect((await primary.readFile("index.md")).data).toEqual(
      encode("I'm back"),
    );

    // Cause a conflict
    console.log("Introducing a conflict now");
    await primary.writeFile("index.md", encode("Hello 1"));
    await secondary.writeFile("index.md", encode("Hello 2"));

    await doSync(sync, snapshot);

    // Sync conflicting copy back
    await doSync(sync, snapshot);

    // Verify that primary won
    expect((await primary.readFile("index.md")).data).toEqual(
      encode("Hello 1"),
    );
    expect((await secondary.readFile("index.md")).data).toEqual(
      encode("Hello 1"),
    );

    // test + index + index.conflicting copy
    expect((await primary.fetchFileList()).length).toEqual(3);
    expect((await secondary.fetchFileList()).length).toEqual(3);

    // Introducing a fake conflict (same content, so not really conflicting)
    await primary.writeFile("index.md", encode("Hello 1"));
    await secondary.writeFile("index.md", encode("Hello 1"));

    await doSync(sync, snapshot);
    await doSync(sync, snapshot);

    // test + index + index.md + previous index.conflicting copy but nothing more
    expect((await primary.fetchFileList()).length).toEqual(3);
  });
});

describe("Sync with filtering", () => {
  test("filter mode switching", async () => {
    const primary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
    const secondary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());

    const snapshot = new SyncSnapshot();
    let sync = new SpaceSync(primary, secondary, {
      conflictResolver: SpaceSync.primaryConflictResolver,
      isSyncCandidate: (path) => path.endsWith(".md"), // Only sync .md files
    });

    console.log(
      "Write one non-sync file on the primary, which SHOULD sync to the secondary",
    );
    await primary.writeFile("index.txt", encode("Hello"));
    expect((await secondary.fetchFileList()).length).toEqual(0);
    let ops = await doSync(sync, snapshot);
    expect(ops).toEqual(1);
    // Note: this number should be 0 because the file DOES have a local representation so it's not technically non-synced
    expect(snapshot.nonSyncedFiles.size).toEqual(0);

    expect((await secondary.fetchFileList()).length).toEqual(1);
    expect((await secondary.readFile("index.txt")).data).toEqual(
      encode("Hello"),
    );

    console.log("Updating on secondary");
    await secondary.writeFile("index.txt", encode("Hello Updated"));
    ops = await doSync(sync, snapshot);
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
    ops = await doSync(sync, snapshot);
    expect(ops).toEqual(1);
    expect(snapshot.nonSyncedFiles.size).toEqual(0);

    console.log("Creating a remote non-synced file");
    await secondary.writeFile("index2.txt", encode("Hello 2"));
    ops = await doSync(sync, snapshot);
    expect(ops).toEqual(0); // No-op, metadata only
    expect(snapshot.nonSyncedFiles.size).toEqual(1);
    ops = await doSync(sync, snapshot);
    expect(ops).toEqual(0); // No-op, metadata only
    expect(snapshot.nonSyncedFiles.size).toEqual(1);

    await primary.writeFile("index2.txt", encode("Hello local"));
    ops = await doSync(sync, snapshot);
    expect(ops).toEqual(1);
    expect(snapshot.nonSyncedFiles.size).toEqual(0);

    console.log("Getting into a state with some synced and non-synced files");
    await secondary.writeFile("index.md", encode("This will sync"));
    await secondary.writeFile("index.txt", encode("This will not sync"));
    await secondary.writeFile("index2.txt", encode("This will not sync"));
    ops = await doSync(sync, snapshot);
    expect(ops).toEqual(2);
    expect(snapshot.nonSyncedFiles.size).toEqual(2);

    // Check file listings on both ends
    expect((await secondary.fetchFileList()).length).toEqual(3);
    expect((await primary.fetchFileList()).length).toEqual(1);

    ////////////
    // Now let's start another sync session, but now wanting to sync everything
    console.log("Going to switch to syncing everything now");
    sync = new SpaceSync(primary, secondary, {
      conflictResolver: SpaceSync.primaryConflictResolver,
      isSyncCandidate: () => true,
    });

    ops = await doSync(sync, snapshot);
    // This should pull 2 files from remote to local
    expect(ops).toEqual(2);
    expect((await primary.fetchFileList()).length).toEqual(3);
    expect((await secondary.fetchFileList()).length).toEqual(3);

    console.log("And now to syncing nothing");
    sync = new SpaceSync(primary, secondary, {
      conflictResolver: SpaceSync.primaryConflictResolver,
      isSyncCandidate: () => false,
    });

    ops = await doSync(sync, snapshot);
    // This should delete 3 files from the primary
    expect(ops).toEqual(3);
    // Leaving nothing on primary
    expect((await primary.fetchFileList()).length).toEqual(0);
    // And everything unchanged on secondary
    expect((await secondary.fetchFileList()).length).toEqual(3);

    // Ok, now we're going to sync everything again
    sync = new SpaceSync(primary, secondary, {
      conflictResolver: SpaceSync.primaryConflictResolver,
      isSyncCandidate: () => true,
    });
    ops = await doSync(sync, snapshot);
    expect(ops).toEqual(3);
    expect((await primary.fetchFileList()).length).toEqual(3);
    expect((await secondary.fetchFileList()).length).toEqual(3);
  });
});

describe("syncSingleFile", () => {
  test("basic push sync", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup({
      isSyncCandidate: (path) => path.endsWith(".md"),
    });

    const operations = await sync.syncFiles(snapshot);
    expect(operations).toEqual(0);

    await primary.writeFile("index.md", encode("Hello"));
    expect(1).toEqual(await sync.syncSingleFile("index.md", snapshot));

    expect((await secondary.readFile("index.md")).data).toEqual(
      encode("Hello"),
    );

    console.log(
      "Let's write a new file on primary that is not a sync candidate",
    );
    await primary.writeFile("test.txt", encode("Hello"));
    expect(1).toEqual(await sync.syncSingleFile("test.txt", snapshot));
    expect(snapshot.nonSyncedFiles.size).toEqual(0);
  });

  test("sync new file from primary to secondary", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();

    await primary.writeFile("new.md", encode("New file"));
    await sleep(10);
    const ops = await sync.syncSingleFile("new.md", snapshot);
    expect(ops).toBe(1);
    expect(decode((await secondary.readFile("new.md")).data)).toBe("New file");
  });

  test("sync changes from primary to secondary", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();

    await primary.writeFile("page.md", encode("v1"));
    await doSync(sync, snapshot);

    await primary.writeFile("page.md", encode("v2"));
    await sleep(10);
    const ops = await sync.syncSingleFile("page.md", snapshot);
    expect(ops).toBe(1);
    expect(decode((await secondary.readFile("page.md")).data)).toBe("v2");
  });

  test("skip non-synced files", async () => {
    const { secondary, snapshot, sync } = createSyncSetup({
      isSyncCandidate: (path) => path.endsWith(".md"),
    });

    await secondary.writeFile("img.png", encode("image"));
    await doSync(sync, snapshot);
    expect(snapshot.nonSyncedFiles.has("img.png")).toBe(true);

    const ops = await sync.syncSingleFile("img.png", snapshot);
    expect(ops).toBe(0); // Skipped
  });

  test("propagate deletion when primary file is deleted", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();

    await primary.writeFile("test.md", encode("Hello"));
    await doSync(sync, snapshot);
    expect(snapshot.files.has("test.md")).toBe(true);
    expect(decode((await secondary.readFile("test.md")).data)).toBe("Hello");

    await primary.deleteFile("test.md");

    const ops = await sync.syncSingleFile("test.md", snapshot);
    expect(ops).toBeGreaterThanOrEqual(0);

    // File should be deleted from secondary
    try {
      await secondary.getFileMeta("test.md");
      expect.fail("Expected file to be deleted from secondary");
    } catch {
      // Expected: file not found
    }

    expect(snapshot.files.has("test.md")).toBe(false);
  });

  test("handle file not existing on either side", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();

    await primary.writeFile("gone.md", encode("Hello"));
    await doSync(sync, snapshot);

    await primary.deleteFile("gone.md");
    await secondary.deleteFile("gone.md");

    const ops = await sync.syncSingleFile("gone.md", snapshot);
    expect(ops).toBeGreaterThanOrEqual(0);
    expect(snapshot.files.has("gone.md")).toBe(false);
  });

  test("sync file only on secondary (not in snapshot)", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();

    // File exists only on secondary, no snapshot entry
    await secondary.writeFile("remote-only.md", encode("Remote content"));
    await sleep(10);

    const ops = await sync.syncSingleFile("remote-only.md", snapshot);
    // syncSingleFile calls syncFile with syncBack=true, so it should copy to primary
    expect(ops).toBe(1);
    expect(decode((await primary.readFile("remote-only.md")).data)).toBe(
      "Remote content",
    );
  });
});

// =================================================================
// nonSyncedFiles snapshot persistence
// =================================================================

describe("nonSyncedFiles snapshot persistence", () => {
  test("snapshotUpdated fires even when only nonSyncedFiles changed", async () => {
    const { secondary, snapshot, sync } = createSyncSetup({
      isSyncCandidate: (path) => path.endsWith(".md"),
    });

    let snapshotSaveCount = 0;
    sync.on({
      snapshotUpdated: () => {
        snapshotSaveCount++;
      },
      syncProgress: () => {},
    });

    await secondary.writeFile("image.png", encode("binary data"));
    await sleep(10);

    snapshotSaveCount = 0;
    const ops = await sync.syncFiles(snapshot);

    expect(ops).toBe(0);
    expect(snapshot.nonSyncedFiles.has("image.png")).toBe(true);
    expect(snapshotSaveCount).toBeGreaterThan(0);
  });

  test("nonSyncedFiles persist across sync cycles", async () => {
    const { secondary, snapshot, sync } = createSyncSetup({
      isSyncCandidate: (path) => path.endsWith(".md"),
    });

    await secondary.writeFile("img1.png", encode("img1"));
    await secondary.writeFile("img2.png", encode("img2"));
    await sleep(10);

    await sync.syncFiles(snapshot);
    expect(snapshot.nonSyncedFiles.size).toBe(2);

    const ops = await doSync(sync, snapshot);
    expect(ops).toBe(0);
    expect(snapshot.nonSyncedFiles.size).toBe(2);
  });
});

// =================================================================
// Mutex/concurrency
// =================================================================

describe("Sync mutex behavior", () => {
  test("concurrent syncFiles calls should be mutexed", async () => {
    const { primary, snapshot, sync } = createSyncSetup();

    await primary.writeFile("test.md", encode("Hello"));
    await sleep(10);

    const [result1, result2] = await Promise.all([
      sync.syncFiles(snapshot),
      sync.syncFiles(snapshot),
    ]);

    const results = [result1, result2].sort((a, b) => a - b);
    expect(results[0]).toBe(-1);
    expect(results[1]).toBeGreaterThanOrEqual(0);
  });

  test("syncSingleFile during syncFiles should return -1", async () => {
    const { secondary, snapshot, sync } = createSyncSetup();

    for (let i = 0; i < 10; i++) {
      await secondary.writeFile(`file${i}.md`, encode(`content ${i}`));
    }
    await sleep(10);

    const fullSyncPromise = sync.syncFiles(snapshot);

    const singleResult = await sync.syncSingleFile("file0.md", snapshot);
    expect(singleResult).toBe(-1);

    await fullSyncPromise;
  });
});

// =================================================================
// Conflict resolution
// =================================================================

describe("Conflict resolution", () => {
  test("fake conflict (same content) should NOT create conflict copy", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();

    await primary.writeFile("test.md", encode("Same content"));
    await doSync(sync, snapshot);

    await primary.writeFile("test.md", encode("Updated same"));
    await secondary.writeFile("test.md", encode("Updated same"));
    await doSync(sync, snapshot);

    const files = await primary.fetchFileList();
    const conflictFiles = files.filter((f) => f.name.includes(".conflicted:"));
    expect(conflictFiles.length).toBe(0);
  });

  test("real conflict creates conflict copy, primary wins", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();

    await primary.writeFile("test.md", encode("Original"));
    await doSync(sync, snapshot);

    await primary.writeFile("test.md", encode("Primary version"));
    await secondary.writeFile("test.md", encode("Secondary version"));
    await doSync(sync, snapshot);

    expect(decode((await primary.readFile("test.md")).data)).toBe(
      "Primary version",
    );
    expect(decode((await secondary.readFile("test.md")).data)).toBe(
      "Primary version",
    );

    const primaryFiles = await primary.fetchFileList();
    const conflictFile = primaryFiles.find((f) =>
      f.name.includes(".conflicted:"),
    );
    expect(conflictFile).toBeDefined();

    const conflictData = await primary.readFile(conflictFile!.name);
    expect(decode(conflictData.data)).toBe("Secondary version");

    await doSync(sync, snapshot);
    const secondaryFiles = await secondary.fetchFileList();
    const secondaryConflict = secondaryFiles.find((f) =>
      f.name.includes(".conflicted:"),
    );
    expect(secondaryConflict).toBeDefined();
  });

  test("conflict on file without extension", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();

    await primary.writeFile("LICENSE", encode("License v1"));
    await doSync(sync, snapshot);

    await primary.writeFile("LICENSE", encode("License v2 primary"));
    await secondary.writeFile("LICENSE", encode("License v2 secondary"));
    await doSync(sync, snapshot);

    expect(decode((await primary.readFile("LICENSE")).data)).toBe(
      "License v2 primary",
    );

    const files = await primary.fetchFileList();
    const conflictFile = files.find((f) =>
      f.name.startsWith("LICENSE.conflicted:"),
    );
    expect(conflictFile).toBeDefined();
  });
});

// =================================================================
// Deletion scenarios
// =================================================================

describe("Deletion scenarios", () => {
  test("primary deletion propagates to secondary", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();

    await primary.writeFile("delete-me.md", encode("Will be deleted"));
    await doSync(sync, snapshot);
    expect(decode((await secondary.readFile("delete-me.md")).data)).toBe(
      "Will be deleted",
    );

    await primary.deleteFile("delete-me.md");
    await doSync(sync, snapshot);

    try {
      await secondary.getFileMeta("delete-me.md");
      expect.fail("Expected file to be deleted from secondary");
    } catch {
      // Expected
    }
  });

  test("secondary deletion propagates to primary", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();

    await secondary.writeFile("delete-me.md", encode("Will be deleted"));
    await doSync(sync, snapshot);
    expect(decode((await primary.readFile("delete-me.md")).data)).toBe(
      "Will be deleted",
    );

    await secondary.deleteFile("delete-me.md");
    await doSync(sync, snapshot);

    try {
      await primary.getFileMeta("delete-me.md");
      expect.fail("Expected file to be deleted from primary");
    } catch {
      // Expected
    }
  });

  test("both sides delete cleans up snapshot", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();

    await primary.writeFile("both-delete.md", encode("Content"));
    await doSync(sync, snapshot);
    expect(snapshot.files.has("both-delete.md")).toBe(true);

    await primary.deleteFile("both-delete.md");
    await secondary.deleteFile("both-delete.md");
    await doSync(sync, snapshot);

    expect(snapshot.files.has("both-delete.md")).toBe(false);
  });

  test("file deleted on secondary, was previously non-synced (sync.ts:321-329)", async () => {
    const primary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
    const secondary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
    const snapshot = new SyncSnapshot();

    // Start with filtered sync so file is tracked as nonSynced
    let sync = new SpaceSync(primary, secondary, {
      conflictResolver: SpaceSync.primaryConflictResolver,
      isSyncCandidate: (path) => path.endsWith(".md"),
    });

    // Create a non-sync-candidate file on both sides via primary push
    await primary.writeFile("data.json", encode('{"key":"value"}'));
    await doSync(sync, snapshot);

    // Secondary should have the file, and it's tracked
    expect(decode((await secondary.readFile("data.json")).data)).toBe(
      '{"key":"value"}',
    );

    // Now update on secondary so it becomes nonSynced
    await secondary.writeFile("data.json", encode('{"key":"updated"}'));
    await doSync(sync, snapshot);
    expect(snapshot.nonSyncedFiles.has("data.json")).toBe(true);

    // Now switch to unfiltered sync (syncBack=true), but delete on secondary
    sync = new SpaceSync(primary, secondary, {
      conflictResolver: SpaceSync.primaryConflictResolver,
      isSyncCandidate: () => true,
    });

    await secondary.deleteFile("data.json");
    await doSync(sync, snapshot);

    // Snapshot should be cleaned up, primary should NOT be deleted
    // (because it was previously non-synced, the code skips the primary delete)
    expect(snapshot.files.has("data.json")).toBe(false);
    expect(snapshot.nonSyncedFiles.has("data.json")).toBe(false);
  });

  test("file deleted on secondary with !syncBack (sync.ts:339-356)", async () => {
    const primary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
    const secondary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
    const snapshot = new SyncSnapshot();

    const sync = new SpaceSync(primary, secondary, {
      conflictResolver: SpaceSync.primaryConflictResolver,
      isSyncCandidate: (path) => path.endsWith(".md"),
    });

    // Create file on primary (which always pushes regardless of filter)
    await primary.writeFile("config.txt", encode("config"));
    await doSync(sync, snapshot);

    // File should be on secondary
    expect(decode((await secondary.readFile("config.txt")).data)).toBe(
      "config",
    );

    // Now delete on secondary
    await secondary.deleteFile("config.txt");
    await doSync(sync, snapshot);

    // Snapshot should be cleaned
    expect(snapshot.files.has("config.txt")).toBe(false);
    expect(snapshot.nonSyncedFiles.has("config.txt")).toBe(false);

    // Primary copy should also be deleted (the !syncBack path attempts deletion)
    try {
      await primary.getFileMeta("config.txt");
      expect.fail("Expected file to be deleted from primary");
    } catch {
      // Expected: file was deleted
    }
  });
});

// =================================================================
// Sync candidate filtering
// =================================================================

describe("Sync candidate filtering", () => {
  test("non-sync candidate on primary still syncs to secondary", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup({
      isSyncCandidate: (path) => path.endsWith(".md"),
    });

    await primary.writeFile("script.js", encode("console.log('hi')"));
    await doSync(sync, snapshot);

    expect(decode((await secondary.readFile("script.js")).data)).toBe(
      "console.log('hi')",
    );
  });

  test("non-sync candidate on secondary tracked in nonSyncedFiles", async () => {
    const { secondary, snapshot, sync } = createSyncSetup({
      isSyncCandidate: (path) => path.endsWith(".md"),
    });

    await secondary.writeFile("image.png", encode("binary"));
    await doSync(sync, snapshot);

    expect(snapshot.nonSyncedFiles.has("image.png")).toBe(true);
  });

  test("switching from filtered to unfiltered pulls missing files", async () => {
    const primary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
    const secondary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
    const snapshot = new SyncSnapshot();

    let sync = new SpaceSync(primary, secondary, {
      conflictResolver: SpaceSync.primaryConflictResolver,
      isSyncCandidate: (path) => path.endsWith(".md"),
    });

    await secondary.writeFile("page.md", encode("markdown"));
    await secondary.writeFile("image.png", encode("image"));
    await doSync(sync, snapshot);

    expect((await primary.fetchFileList()).length).toBe(1);
    expect(snapshot.nonSyncedFiles.has("image.png")).toBe(true);

    sync = new SpaceSync(primary, secondary, {
      conflictResolver: SpaceSync.primaryConflictResolver,
      isSyncCandidate: () => true,
    });

    await doSync(sync, snapshot);

    expect((await primary.fetchFileList()).length).toBe(2);
    expect(snapshot.nonSyncedFiles.size).toBe(0);
  });
});

// =================================================================
// Resync scenario (both sides have file, no snapshot entry)
// =================================================================

describe("Resync scenario", () => {
  test("both sides have file but no snapshot entry, same content", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();

    // Write same content to both sides without syncing
    await primary.writeFile("resync.md", encode("Same content"));
    await secondary.writeFile("resync.md", encode("Same content"));
    await sleep(10);

    // No snapshot entry exists — this is a resync scenario (sync.ts:454-458)
    const ops = await doSync(sync, snapshot);

    // Should go through conflict resolver, detect same content, no conflict copy
    const files = await primary.fetchFileList();
    const conflictFiles = files.filter((f) => f.name.includes(".conflicted:"));
    expect(conflictFiles.length).toBe(0);
    // Snapshot should now have the file
    expect(snapshot.files.has("resync.md")).toBe(true);
    expect(ops).toBe(0); // Same content = 0 ops from conflict resolver
  });

  test("both sides have file but no snapshot entry, different content", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();

    await primary.writeFile("resync.md", encode("Primary version"));
    await secondary.writeFile("resync.md", encode("Secondary version"));
    await sleep(10);

    await doSync(sync, snapshot);

    // Primary should win
    expect(decode((await primary.readFile("resync.md")).data)).toBe(
      "Primary version",
    );

    // Conflict copy should exist
    const files = await primary.fetchFileList();
    const conflictFile = files.find((f) => f.name.includes(".conflicted:"));
    expect(conflictFile).toBeDefined();
  });
});

// =================================================================
// Size mismatch conflict
// =================================================================

describe("Size mismatch conflict", () => {
  test("matching timestamps but different sizes triggers conflict resolution", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();

    // Initial sync
    await primary.writeFile("data.bin", encode("original"));
    await doSync(sync, snapshot);

    // Manually manipulate the snapshot to simulate matching timestamps
    // but the underlying files have different sizes

    // Write different-sized content directly (bypass normal sync)
    await primary.writeFile("data.bin", encode("short"));
    await secondary.writeFile("data.bin", encode("much longer content here"));

    // Set snapshot timestamps to match current files' timestamps
    const primaryMeta = await primary.getFileMeta("data.bin");
    const secondaryMeta = await secondary.getFileMeta("data.bin");
    snapshot.files.set("data.bin", [
      primaryMeta.lastModified,
      secondaryMeta.lastModified,
    ]);

    // Now sync — sizes differ despite timestamps matching in snapshot
    // This should trigger the size mismatch conflict path
    await doSync(sync, snapshot);

    // Primary should win (primaryConflictResolver)
    expect(decode((await primary.readFile("data.bin")).data)).toBe("short");
    expect(decode((await secondary.readFile("data.bin")).data)).toBe("short");

    // Conflict copy should exist
    const files = await primary.fetchFileList();
    const conflictFile = files.find((f) => f.name.includes(".conflicted:"));
    expect(conflictFile).toBeDefined();
  });
});

// =================================================================
// Empty file sync
// =================================================================

describe("Empty file sync", () => {
  test("zero-byte files sync correctly in both directions", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();

    // Empty file from primary to secondary
    await primary.writeFile("empty.md", encode(""));
    await doSync(sync, snapshot);

    const secondaryData = await secondary.readFile("empty.md");
    expect(secondaryData.data.byteLength).toBe(0);

    // Empty file from secondary to primary
    await secondary.writeFile("empty2.md", encode(""));
    await doSync(sync, snapshot);

    const primaryData = await primary.readFile("empty2.md");
    expect(primaryData.data.byteLength).toBe(0);

    // Update empty file to have content
    await primary.writeFile("empty.md", encode("now has content"));
    await doSync(sync, snapshot);

    expect(decode((await secondary.readFile("empty.md")).data)).toBe(
      "now has content",
    );

    // Update back to empty
    await primary.writeFile("empty.md", encode(""));
    await doSync(sync, snapshot);

    expect((await secondary.readFile("empty.md")).data.byteLength).toBe(0);
  });
});

// =================================================================
// syncProgress event
// =================================================================

describe("syncProgress event", () => {
  test("fires during syncFiles with correct counts", async () => {
    const { secondary, snapshot, sync } = createSyncSetup();
    const progressEvents: { filesProcessed: number; totalFiles: number }[] = [];

    sync.on({
      snapshotUpdated: () => {},
      syncProgress: (status) => {
        progressEvents.push({ ...status });
      },
    });

    await secondary.writeFile("a.md", encode("a"));
    await secondary.writeFile("b.md", encode("b"));
    await secondary.writeFile("c.md", encode("c"));
    await sleep(10);

    await sync.syncFiles(snapshot);

    // syncProgress only fires when fileOperations > 0
    expect(progressEvents.length).toBeGreaterThan(0);

    // Each event should have valid counts
    for (const event of progressEvents) {
      expect(event.filesProcessed).toBeGreaterThan(0);
      expect(event.totalFiles).toBe(3);
      expect(event.filesProcessed).toBeLessThanOrEqual(event.totalFiles);
    }
  });
});
