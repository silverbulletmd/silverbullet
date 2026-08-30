import { createHash } from "node:crypto";
import { sleep } from "@silverbulletmd/silverbullet/lib/async";
import { hashSHA256 } from "@silverbulletmd/silverbullet/lib/crypto";
import type { FileMeta } from "@silverbulletmd/silverbullet/type/index";
import { describe, expect, test } from "vitest";
import { MemoryKvPrimitives } from "../data/memory_kv_primitives.ts";
import { BaseStore } from "./base_store.ts";
import { DataStoreSpacePrimitives } from "./datastore_space_primitives.ts";
import {
  PreconditionFailedError,
  ReconcileIneligibleError,
  type ReconcileRequest,
  type ReconcileResponse,
  type WritePrecondition,
} from "./http_space_primitives.ts";
import { isMergeEligible, SpaceSync, SyncSnapshot } from "./sync.ts";

const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

/**
 * The revision a SilverBullet server reports: sha256 of the content. Only
 * `sha256:`-prefixed ETags become recorded revisions (see `hashFromEtag`), so
 * a recorded hash is always this, which is what lets the engine compare local
 * content against it.
 */
function serverHash(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Wraps a DataStoreSpacePrimitives with the conditional methods
 * (writeFileConditional/readFileWithHash/deleteFileConditional) that
 * HttpSpacePrimitives exposes, so the sync engine's revision-aware paths
 * can be exercised without a real HTTP server. Records every call made
 * to the conditional methods, and can be told to fail the next write or
 * delete with a PreconditionFailedError.
 */
class ConditionalSecondaryStub {
  writeCalls: { path: string; precondition?: WritePrecondition }[] = [];
  deleteCalls: { path: string; expectedHash?: string }[] = [];
  failNextWrite = false;
  /** When set, `failNextWrite` only fires for writes to this path. */
  failNextWritePath?: string;
  failNextDelete = false;
  readWithHashCalls: string[] = [];
  /** Runs at the start of readFileWithHash, to race a write against the read. */
  readWithHashHook?: (path: string) => void | Promise<void>;

  reconcileCalls: { path: string; req: ReconcileRequest }[] = [];
  reconcileResponse:
    | ReconcileResponse
    | null
    | "ineligible"
    | "transport-error" = null;
  reconcileHook?: () => void | Promise<void>;

  constructor(readonly inner: DataStoreSpacePrimitives) {}

  fetchFileList() {
    return this.inner.fetchFileList();
  }

  getFileMeta(path: string, observing?: boolean) {
    return this.inner.getFileMeta(path, observing);
  }

  readFile(path: string) {
    return this.inner.readFile(path);
  }

  async readFileWithHash(
    path: string,
  ): Promise<{ data: Uint8Array; meta: FileMeta; remoteHash?: string }> {
    this.readWithHashCalls.push(path);
    if (this.readWithHashHook) {
      await this.readWithHashHook(path);
    }
    const { data, meta } = await this.inner.readFile(path);
    return { data, meta, remoteHash: serverHash(data) };
  }

  async writeFile(path: string, data: Uint8Array, meta?: FileMeta) {
    const { meta: writtenMeta } = await this.writeFileConditional(
      path,
      data,
      meta,
    );
    return writtenMeta;
  }

  async writeFileConditional(
    path: string,
    data: Uint8Array,
    meta?: FileMeta,
    precondition?: WritePrecondition,
  ): Promise<{ meta: FileMeta; remoteHash?: string }> {
    this.writeCalls.push({ path, precondition });
    if (
      this.failNextWrite &&
      (this.failNextWritePath === undefined || this.failNextWritePath === path)
    ) {
      this.failNextWrite = false;
      throw new PreconditionFailedError(`Precondition failed for ${path}`);
    }
    const writtenMeta = await this.inner.writeFile(path, data, meta);
    return { meta: writtenMeta, remoteHash: serverHash(data) };
  }

  async deleteFile(path: string) {
    await this.deleteFileConditional(path);
  }

  async deleteFileConditional(path: string, expectedHash?: string) {
    this.deleteCalls.push({ path, expectedHash });
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new PreconditionFailedError(`Precondition failed for ${path}`);
    }
    if (expectedHash !== undefined) {
      const current = await this.inner.readFile(path).then(
        ({ data }) => serverHash(data),
        () => undefined,
      );
      if (current !== expectedHash) {
        throw new PreconditionFailedError(`Precondition failed for ${path}`);
      }
    }
    await this.inner.deleteFile(path);
  }

  async reconcile(
    path: string,
    req: ReconcileRequest,
  ): Promise<ReconcileResponse | null> {
    this.reconcileCalls.push({ path, req });
    if (this.reconcileHook) {
      await this.reconcileHook();
    }
    if (this.reconcileResponse === "ineligible") {
      throw new ReconcileIneligibleError(`Reconcile ineligible for ${path}`);
    }
    if (this.reconcileResponse === "transport-error") {
      throw new Error(`Network error reconciling ${path}`);
    }
    return this.reconcileResponse;
  }
}

function createConditionalSyncSetup(opts?: {
  isSyncCandidate?: (path: string) => boolean;
}) {
  const primary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
  const secondaryInner = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
  const secondary = new ConditionalSecondaryStub(secondaryInner);
  const snapshot = new SyncSnapshot();
  // deno-lint-ignore no-explicit-any
  const sync = new SpaceSync(primary, secondary as any, {
    conflictResolver: SpaceSync.primaryConflictResolver,
    isSyncCandidate: opts?.isSyncCandidate ?? (() => true),
  });
  return { primary, secondary, snapshot, sync };
}

function createReconcileSyncSetup(opts?: {
  isSyncCandidate?: (path: string) => boolean;
}) {
  const primary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
  const secondaryInner = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
  const secondary = new ConditionalSecondaryStub(secondaryInner);
  const baseStore = new BaseStore(new MemoryKvPrimitives());
  const snapshot = new SyncSnapshot();
  const resyncedPaths: string[] = [];
  // deno-lint-ignore no-explicit-any
  const sync = new SpaceSync(primary, secondary as any, {
    conflictResolver: SpaceSync.primaryConflictResolver,
    isSyncCandidate: opts?.isSyncCandidate ?? (() => true),
    baseStore,
    onScheduleResync: (path) => resyncedPaths.push(path),
  });
  return { primary, secondary, snapshot, sync, baseStore, resyncedPaths };
}

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
    const conflictFiles = files.filter((f) => f.name.includes(".conflicted-"));
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
      f.name.includes(".conflicted-"),
    );
    expect(conflictFile).toBeDefined();

    const conflictData = await primary.readFile(conflictFile!.name);
    expect(decode(conflictData.data)).toBe("Secondary version");

    await doSync(sync, snapshot);
    const secondaryFiles = await secondary.fetchFileList();
    const secondaryConflict = secondaryFiles.find((f) =>
      f.name.includes(".conflicted-"),
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
      f.name.startsWith("LICENSE.conflicted-"),
    );
    expect(conflictFile).toBeDefined();
  });

  test("conflict copy is named after sha256 of the losing (secondary) revision", async () => {
    const primary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
    const secondary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
    const snapshot = new SyncSnapshot();

    await primary.writeFile("test.md", encode("Primary version"));
    await secondary.writeFile("test.md", encode("Secondary version"));

    await SpaceSync.primaryConflictResolver(
      "test.md",
      snapshot,
      primary,
      secondary,
    );

    const hash8 = (await hashSHA256(encode("Secondary version"))).slice(0, 8);
    const expectedName = `test.conflicted-${hash8}.md`;
    expect(decode((await primary.readFile(expectedName)).data)).toBe(
      "Secondary version",
    );
    expect(decode((await secondary.readFile(expectedName)).data)).toBe(
      "Secondary version",
    );
  });

  test("resolving the same divergent pair twice creates exactly one conflict copy", async () => {
    const primary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
    const secondary = new DataStoreSpacePrimitives(new MemoryKvPrimitives());
    const snapshot = new SyncSnapshot();

    await primary.writeFile("test.md", encode("Primary version"));
    await secondary.writeFile("test.md", encode("Secondary version"));

    const ops1 = await SpaceSync.primaryConflictResolver(
      "test.md",
      snapshot,
      primary,
      secondary,
    );
    expect(ops1).toBeGreaterThan(0);

    const conflictCount = async (space: DataStoreSpacePrimitives) =>
      (await space.fetchFileList()).filter((f) =>
        f.name.includes(".conflicted-"),
      ).length;
    expect(await conflictCount(primary)).toBe(1);

    // The same divergent pair recurs (e.g. the exact same losing content
    // reappears on the secondary) and gets resolved a second time.
    await secondary.writeFile("test.md", encode("Secondary version"));
    const ops2 = await SpaceSync.primaryConflictResolver(
      "test.md",
      snapshot,
      primary,
      secondary,
    );
    expect(ops2).toBeGreaterThan(0);

    expect(await conflictCount(primary)).toBe(1);
    expect(await conflictCount(secondary)).toBe(1);
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
    const conflictFiles = files.filter((f) => f.name.includes(".conflicted-"));
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
    const conflictFile = files.find((f) => f.name.includes(".conflicted-"));
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
    const conflictFile = files.find((f) => f.name.includes(".conflicted-"));
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

// =================================================================
// SyncSnapshot remoteHashes (de)serialization
// =================================================================

describe("SyncSnapshot remoteHashes", () => {
  test("toJSON/fromJSON roundtrip matches Rust wire format", () => {
    const snapshot = new SyncSnapshot(
      new Map([["a.md", [1, 2] as [number, number]]]),
      new Map(),
      new Map([["a.md", "ff"]]),
    );

    expect(snapshot.toJSON()).toEqual({
      files: { "a.md": [1, 2] },
      nonSyncedFiles: {},
      remoteHashes: { "a.md": "ff" },
      baseHashes: {},
    });

    const restored = SyncSnapshot.fromJSON(snapshot.toJSON());
    expect(restored.files.get("a.md")).toEqual([1, 2]);
    expect(restored.remoteHashes.get("a.md")).toEqual("ff");
  });

  test("fromJSON defaults remoteHashes to empty for legacy snapshots", () => {
    const legacy = { files: { "a.md": [1, 2] } };
    const restored = SyncSnapshot.fromJSON(legacy);
    expect(restored.files.get("a.md")).toEqual([1, 2]);
    expect(restored.remoteHashes.size).toBe(0);
  });
});

// =================================================================
// SyncSnapshot baseHashes (de)serialization
// =================================================================

describe("SyncSnapshot baseHashes", () => {
  test("fromJSON on the shared wire fixture populates baseHashes", () => {
    const wireFixture =
      '{"files":{"a.md":[1,2]},"remoteHashes":{"a.md":"ff"},"baseHashes":{"a.md":"ee"}}';
    const restored = SyncSnapshot.fromJSON(JSON.parse(wireFixture));
    expect(restored.files.get("a.md")).toEqual([1, 2]);
    expect(restored.remoteHashes.get("a.md")).toEqual("ff");
    expect(restored.baseHashes.get("a.md")).toEqual("ee");
  });

  test("toJSON/fromJSON roundtrips baseHashes", () => {
    const snapshot = new SyncSnapshot(
      new Map([["a.md", [1, 2] as [number, number]]]),
      new Map(),
      new Map([["a.md", "ff"]]),
      new Map([["a.md", "ee"]]),
    );

    expect(snapshot.toJSON()).toEqual({
      files: { "a.md": [1, 2] },
      nonSyncedFiles: {},
      remoteHashes: { "a.md": "ff" },
      baseHashes: { "a.md": "ee" },
    });

    const restored = SyncSnapshot.fromJSON(snapshot.toJSON());
    expect(restored.baseHashes.get("a.md")).toEqual("ee");
  });

  test("fromJSON defaults baseHashes to empty for legacy snapshots without the key", () => {
    const legacy = {
      files: { "a.md": [1, 2] },
      remoteHashes: { "a.md": "ff" },
    };
    const restored = SyncSnapshot.fromJSON(legacy);
    expect(restored.baseHashes.size).toBe(0);
  });
});

// =================================================================
// Precondition-aware pushes/pulls/deletes (revision-aware sync engine)
// =================================================================

describe("Precondition-aware sync", () => {
  test("push of new file on primary sends unconditional write when no hashes known yet", async () => {
    const { primary, secondary, snapshot, sync } = createConditionalSyncSetup();

    await primary.writeFile("new.md", encode("Hello"));
    await doSync(sync, snapshot);

    expect(secondary.writeCalls.length).toBe(1);
    expect(secondary.writeCalls[0].precondition).toBeUndefined();
    expect(snapshot.remoteHashes.has("new.md")).toBe(true);
  });

  test("push of new file sends notExists precondition once hashes are known", async () => {
    const { primary, secondary, snapshot, sync } = createConditionalSyncSetup();

    // First file establishes a remoteHashes entry.
    await primary.writeFile("first.md", encode("First"));
    await doSync(sync, snapshot);
    expect(snapshot.remoteHashes.size).toBeGreaterThan(0);

    await primary.writeFile("second.md", encode("Second"));
    await doSync(sync, snapshot);

    const secondCall = secondary.writeCalls.find((c) => c.path === "second.md");
    expect(secondCall?.precondition).toEqual({ type: "notExists" });
  });

  test("push of changed file sends if-match with recorded hash", async () => {
    const { primary, secondary, snapshot, sync } = createConditionalSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await doSync(sync, snapshot);
    const recordedHash = snapshot.remoteHashes.get("doc.md");
    expect(recordedHash).toBeTruthy();

    await primary.writeFile("doc.md", encode("v2"));
    await doSync(sync, snapshot);

    const updateCall = secondary.writeCalls.find(
      (c) => c.path === "doc.md" && c.precondition?.type === "matchesHash",
    );
    expect(updateCall?.precondition).toEqual({
      type: "matchesHash",
      hash: recordedHash,
    });
  });

  test("push of changed file is unconditional when the remote never reported a revision", async () => {
    const { primary, secondary, snapshot, sync } = createConditionalSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await doSync(sync, snapshot);
    // An empty map is the "remote isn't known revision-capable" probe.
    snapshot.remoteHashes.clear();
    secondary.readWithHashCalls.length = 0;

    await primary.writeFile("doc.md", encode("v2"));
    await doSync(sync, snapshot);

    const updateCall = secondary.writeCalls.at(-1);
    expect(updateCall?.precondition).toBeUndefined();
    expect(secondary.readWithHashCalls).toEqual([]);
  });

  test("412 on push routes into conflict resolver instead of throwing", async () => {
    const { primary, secondary, snapshot, sync } = createConditionalSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await doSync(sync, snapshot);

    await primary.writeFile("doc.md", encode("v2"));
    secondary.failNextWrite = true;

    await expect(doSync(sync, snapshot)).resolves.not.toThrow();

    // Conflict copy should exist on primary (secondary's stale content preserved)
    const primaryFiles = await primary.fetchFileList();
    const conflictFile = primaryFiles.find((f) =>
      f.name.includes(".conflicted-"),
    );
    expect(conflictFile).toBeDefined();
  });

  test("412 on remote delete pulls the remote edit instead of retrying forever", async () => {
    const { primary, secondary, snapshot, sync } = createConditionalSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await doSync(sync, snapshot);
    expect(snapshot.files.has("doc.md")).toBe(true);

    const suppressedPaths: string[] = [];
    sync.on({
      suppressedDeletion: (path) => {
        suppressedPaths.push(path);
      },
    });

    await primary.deleteFile("doc.md");
    // Remote edit lands concurrently with the local delete.
    await secondary.writeFile("doc.md", encode("v2"));
    secondary.failNextDelete = true;

    const ops = await doSync(sync, snapshot);
    expect(ops).toBeGreaterThan(0);

    // The remote's edit wins: it's pulled back to primary.
    expect(decode((await primary.readFile("doc.md")).data)).toBe("v2");
    expect(snapshot.files.has("doc.md")).toBe(true);
    expect(snapshot.remoteHashes.get("doc.md")).toBe(serverHash(encode("v2")));
    expect(suppressedPaths).toEqual(["doc.md"]);

    // Convergence: the next cycle is a no-op, delete isn't retried.
    const writeCallsBefore = secondary.writeCalls.length;
    const deleteCallsBefore = secondary.deleteCalls.length;
    const ops2 = await doSync(sync, snapshot);
    expect(ops2).toBe(0);
    expect(secondary.writeCalls.length).toBe(writeCallsBefore);
    expect(secondary.deleteCalls.length).toBe(deleteCallsBefore);
  });

  test("remote deletion does not destroy an unsynced local edit", async () => {
    const { primary, secondary, snapshot, sync } = createConditionalSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await doSync(sync, snapshot);

    const suppressedPaths: string[] = [];
    sync.on({
      suppressedDeletion: (path) => {
        suppressedPaths.push(path);
      },
    });

    // Another replica deletes the remote copy while this one holds an edit
    // that was never pushed.
    await secondary.deleteFile("doc.md");
    await sleep(10);
    await primary.writeFile("doc.md", encode("v2-local"));

    const ops = await doSync(sync, snapshot);
    expect(ops).toBe(1);

    expect(decode((await primary.readFile("doc.md")).data)).toBe("v2-local");
    expect(decode((await secondary.readFile("doc.md")).data)).toBe("v2-local");
    expect(secondary.writeCalls.at(-1)?.precondition).toEqual({
      type: "notExists",
    });
    expect(suppressedPaths).toEqual(["doc.md"]);
    expect(snapshot.files.has("doc.md")).toBe(true);
    expect(snapshot.remoteHashes.get("doc.md")).toBe(
      serverHash(encode("v2-local")),
    );

    expect(await doSync(sync, snapshot)).toBe(0);
  });

  test("remote deletion is adopted when the local copy is unchanged", async () => {
    const { primary, secondary, snapshot, sync } = createConditionalSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await doSync(sync, snapshot);

    const suppressedPaths: string[] = [];
    sync.on({
      suppressedDeletion: (path) => {
        suppressedPaths.push(path);
      },
    });

    await secondary.deleteFile("doc.md");

    const ops = await doSync(sync, snapshot);
    expect(ops).toBe(1);

    await expect(primary.getFileMeta("doc.md")).rejects.toThrow();
    expect(snapshot.files.has("doc.md")).toBe(false);
    expect(snapshot.remoteHashes.has("doc.md")).toBe(false);
    expect(snapshot.baseHashes.has("doc.md")).toBe(false);
    expect(suppressedPaths).toEqual([]);

    expect(await doSync(sync, snapshot)).toBe(0);
  });

  test("pull from secondary records remote hash", async () => {
    const { secondary, snapshot, sync } = createConditionalSyncSetup();

    await secondary.writeFile("remote.md", encode("Remote content"));
    await doSync(sync, snapshot);

    expect(snapshot.remoteHashes.has("remote.md")).toBe(true);
  });

  test("conflict resolver's byte-match early return refreshes stale remoteHashes", async () => {
    const { primary, secondary, snapshot, sync } = createConditionalSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await doSync(sync, snapshot);

    // Seed a stale remote hash, simulating a hash that no longer matches
    // what's actually on the secondary.
    snapshot.remoteHashes.set("doc.md", "stale-hash");

    // Both sides change to byte-identical content with fresh timestamps,
    // so syncFile routes this through the conflict resolver.
    await primary.writeFile("doc.md", encode("v2"));
    await sleep(10);
    await secondary.writeFile("doc.md", encode("v2"));

    await doSync(sync, snapshot);

    // Byte-wise match means no conflict copy should be created.
    const files = await primary.fetchFileList();
    expect(files.some((f) => f.name.includes(".conflicted-"))).toBe(false);

    const currentRemoteData = (await secondary.readFile("doc.md")).data;
    expect(snapshot.remoteHashes.get("doc.md")).toBe(
      serverHash(currentRemoteData),
    );
    expect(snapshot.remoteHashes.get("doc.md")).not.toBe("stale-hash");
  });

  test("plain secondary without conditional methods behaves as before (no preconditions)", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await doSync(sync, snapshot);
    await primary.writeFile("doc.md", encode("v2"));
    await doSync(sync, snapshot);

    expect(snapshot.remoteHashes.size).toBe(0);
    expect(decode((await secondary.readFile("doc.md")).data)).toBe("v2");
  });
});

// =================================================================
// isMergeEligible
// =================================================================

describe("isMergeEligible", () => {
  test("truth table", () => {
    expect(isMergeEligible("note.md", 100)).toBe(true);
    expect(isMergeEligible("note.txt", 100)).toBe(true);
    expect(isMergeEligible("script.lua", 100)).toBe(true);
    expect(isMergeEligible("style.css", 100)).toBe(true);
    expect(isMergeEligible("data.json", 100)).toBe(true);
    expect(isMergeEligible("config.yaml", 100)).toBe(true);
    expect(isMergeEligible("config.yml", 100)).toBe(true);
    expect(isMergeEligible("config.toml", 100)).toBe(true);
    expect(isMergeEligible("readme.html", 100)).toBe(true); // text/html via mime
    expect(isMergeEligible("image.png", 100)).toBe(false);
    expect(isMergeEligible("archive.zip", 100)).toBe(false);
    expect(isMergeEligible("LICENSE", 100)).toBe(false);
    expect(isMergeEligible("note.md", 1_048_576)).toBe(true);
    expect(isMergeEligible("note.md", 1_048_577)).toBe(false);
  });
});

// =================================================================
// Three-way reconciliation
// =================================================================

describe("Three-way reconciliation", () => {
  test("base captured on push of new file", async () => {
    const { primary, snapshot, sync, baseStore } = createReconcileSyncSetup();

    await primary.writeFile("new.md", encode("Hello"));
    await doSync(sync, snapshot);

    const expectedHash = await hashSHA256(encode("Hello"));
    expect(snapshot.baseHashes.get("new.md")).toBe(expectedHash);
    expect(await baseStore.getBase(expectedHash)).toEqual(encode("Hello"));
  });

  test("base captured on pull of new file", async () => {
    const { secondary, snapshot, sync, baseStore } = createReconcileSyncSetup();

    await secondary.writeFile("remote.md", encode("Remote content"));
    await doSync(sync, snapshot);

    const expectedHash = await hashSHA256(encode("Remote content"));
    expect(snapshot.baseHashes.get("remote.md")).toBe(expectedHash);
    expect(await baseStore.getBase(expectedHash)).toEqual(
      encode("Remote content"),
    );
  });

  test("merged apply on changed-file 412: request built correctly, local updated, hashes tracked", async () => {
    const { primary, secondary, snapshot, sync, baseStore } =
      createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("base content"));
    await doSync(sync, snapshot);
    const baseHash = snapshot.baseHashes.get("doc.md")!;
    expect(baseHash).toBeTruthy();

    await primary.writeFile("doc.md", encode("local edit"));
    secondary.failNextWrite = true;
    secondary.reconcileResponse = {
      status: "merged",
      revision: {
        algorithm: "sha256",
        hash: "server-remote-hash",
        size: 11,
        lastModified: 99999,
      },
      text: "merged text",
    };

    const ops = await doSync(sync, snapshot);
    expect(ops).toBeGreaterThan(0);

    expect(secondary.reconcileCalls.length).toBe(1);
    const req = secondary.reconcileCalls[0].req;
    expect(req.baseHash).toBe(baseHash);
    expect(req.baseText).toBe("base content");
    expect(req.proposedText).toBe("local edit");
    expect(req.proposedHash).toBe(await hashSHA256(encode("local edit")));

    expect(decode((await primary.readFile("doc.md")).data)).toBe("merged text");
    expect(snapshot.files.get("doc.md")).toEqual([99999, 99999]);
    expect(snapshot.remoteHashes.get("doc.md")).toBe("server-remote-hash");

    const resultHash = await hashSHA256(encode("merged text"));
    expect(snapshot.baseHashes.get("doc.md")).toBe(resultHash);
    expect(await baseStore.getBase(resultHash)).toEqual(encode("merged text"));
  });

  test("conflicted apply writes marker text locally and emits syncConflict", async () => {
    const { primary, secondary, snapshot, sync } = createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("base content"));
    await doSync(sync, snapshot);

    await primary.writeFile("doc.md", encode("local edit"));
    secondary.failNextWrite = true;

    const markerText =
      "<<<<<<< SB sha256:aaa\nlocal edit\n||||||| SB BASE sha256:bbb\nbase content\n=======\nremote edit\n>>>>>>> SB sha256:ccc";
    secondary.reconcileResponse = {
      status: "conflicted",
      revision: {
        algorithm: "sha256",
        hash: "server-remote-hash",
        size: markerText.length,
        lastModified: 55555,
      },
      text: markerText,
    };

    const conflictEvents: string[] = [];
    sync.on({
      syncConflict: (path) => {
        conflictEvents.push(path);
      },
    });

    await doSync(sync, snapshot);

    expect(decode((await primary.readFile("doc.md")).data)).toBe(markerText);
    expect(conflictEvents).toEqual(["doc.md"]);
  });

  test("local advanced during flight: result not applied, base becomes proposed, resync scheduled", async () => {
    const { primary, secondary, snapshot, sync, baseStore, resyncedPaths } =
      createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("base content"));
    await doSync(sync, snapshot);

    await primary.writeFile("doc.md", encode("local edit"));
    secondary.failNextWrite = true;
    secondary.reconcileResponse = {
      status: "merged",
      revision: {
        algorithm: "sha256",
        hash: "server-remote-hash",
        size: 5,
        lastModified: 99999,
      },
      text: "merged text",
    };
    secondary.reconcileHook = async () => {
      // Simulate a further local edit landing while reconciliation is in flight.
      await primary.writeFile("doc.md", encode("even newer local edit"));
    };

    await doSync(sync, snapshot);

    expect(decode((await primary.readFile("doc.md")).data)).toBe(
      "even newer local edit",
    );

    const proposedHash = await hashSHA256(encode("local edit"));
    expect(snapshot.baseHashes.get("doc.md")).toBe(proposedHash);
    expect(await baseStore.getBase(proposedHash)).toEqual(encode("local edit"));
    // The merged revision was never held locally, so it must not be recorded:
    // remoteHashes still names the last revision this replica actually had.
    expect(snapshot.remoteHashes.get("doc.md")).toBe(
      serverHash(encode("base content")),
    );
    expect(resyncedPaths).toContain("doc.md");
  });

  test("cycle after local-advanced reconciles L1 against L2 instead of pushing over the merge", async () => {
    const { primary, secondary, snapshot, sync } = createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("base content"));
    await doSync(sync, snapshot);
    const entryBefore = snapshot.files.get("doc.md");

    await primary.writeFile("doc.md", encode("local edit L1"));
    secondary.failNextWrite = true;
    secondary.reconcileResponse = {
      status: "merged",
      revision: {
        algorithm: "sha256",
        hash: serverHash(encode("merge M")),
        size: 7,
        lastModified: 424242,
      },
      text: "merge M",
    };
    secondary.reconcileHook = async () => {
      // The server lands the merge M while the local file races ahead to L2.
      await primary.writeFile("doc.md", encode("local edit L2"));
      await secondary.writeFile("doc.md", encode("merge M"), {
        name: "doc.md",
        created: 1,
        lastModified: 424242,
        contentType: "text/markdown",
        size: 7,
        perm: "rw",
      });
    };

    await doSync(sync, snapshot);

    expect(decode((await primary.readFile("doc.md")).data)).toBe(
      "local edit L2",
    );
    expect(snapshot.files.get("doc.md")).toEqual(entryBefore);
    expect(snapshot.remoteHashes.get("doc.md")).toBe(
      serverHash(encode("base content")),
    );

    secondary.reconcileHook = undefined;
    secondary.reconcileResponse = {
      status: "merged",
      revision: {
        algorithm: "sha256",
        hash: serverHash(encode("merge of L1, L2 and M")),
        size: 21,
        lastModified: 999999,
      },
      text: "merge of L1, L2 and M",
    };

    await doSync(sync, snapshot);

    expect(secondary.reconcileCalls.length).toBe(2);
    const followUp = secondary.reconcileCalls[1].req;
    expect(followUp.baseText).toBe("local edit L1");
    expect(followUp.proposedText).toBe("local edit L2");
    expect(decode((await secondary.readFile("doc.md")).data)).toBe("merge M");
  });

  test("cycle after a local-advanced delete restores the canonical revision instead of deleting it", async () => {
    const { primary, secondary, snapshot, sync } = createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("base content"));
    await doSync(sync, snapshot);
    const entryBefore = snapshot.files.get("doc.md");

    await primary.writeFile("doc.md", encode("local edit L1"));
    secondary.failNextWrite = true;
    secondary.reconcileResponse = {
      status: "merged",
      revision: {
        algorithm: "sha256",
        hash: serverHash(encode("merge M")),
        size: 7,
        lastModified: 424242,
      },
      text: "merge M",
    };
    secondary.reconcileHook = async () => {
      await primary.deleteFile("doc.md");
      await secondary.writeFile("doc.md", encode("merge M"), {
        name: "doc.md",
        created: 1,
        lastModified: 424242,
        contentType: "text/markdown",
        size: 7,
        perm: "rw",
      });
    };

    await doSync(sync, snapshot);

    await expect(primary.getFileMeta("doc.md")).rejects.toThrow();
    expect(snapshot.files.get("doc.md")).toEqual(entryBefore);
    // Recording M here would make the next cycle's conditional delete succeed
    // and destroy it; the stale hash is what makes that delete fail instead.
    expect(snapshot.remoteHashes.get("doc.md")).toBe(
      serverHash(encode("base content")),
    );

    secondary.reconcileHook = undefined;

    await doSync(sync, snapshot);

    expect(secondary.deleteCalls.length).toBe(1);
    expect(decode((await secondary.readFile("doc.md")).data)).toBe("merge M");
    expect(decode((await primary.readFile("doc.md")).data)).toBe("merge M");
  });

  test("retry result: no local write, remoteHashes untouched, resync scheduled", async () => {
    const { primary, secondary, snapshot, sync, resyncedPaths } =
      createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("base content"));
    await doSync(sync, snapshot);

    await primary.writeFile("doc.md", encode("local edit"));
    secondary.failNextWrite = true;
    secondary.reconcileResponse = {
      status: "retry",
      revision: {
        algorithm: "sha256",
        hash: "retry-hash",
        size: 5,
        lastModified: 12345,
      },
    };

    await doSync(sync, snapshot);

    expect(decode((await primary.readFile("doc.md")).data)).toBe("local edit");
    // The churn revision was never held locally, so it must not be recorded.
    expect(snapshot.remoteHashes.get("doc.md")).toBe(
      serverHash(encode("base content")),
    );
    expect(resyncedPaths).toContain("doc.md");
  });

  test("null response (server unsupported) falls back to legacy conflict resolver, remembered for the session", async () => {
    const { primary, secondary, snapshot, sync } = createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("base content"));
    await doSync(sync, snapshot);

    await primary.writeFile("doc.md", encode("primary edit"));
    secondary.failNextWrite = true;
    secondary.reconcileResponse = null;

    await doSync(sync, snapshot);

    const files = await primary.fetchFileList();
    expect(files.some((f) => f.name.includes(".conflicted-"))).toBe(true);
    expect(secondary.reconcileCalls.length).toBe(1);

    // Trigger a second 412 in the same engine instance
    await primary.writeFile("doc.md", encode("primary edit 2"));
    secondary.failNextWrite = true;
    await doSync(sync, snapshot);

    // Reconcile should not have been attempted again
    expect(secondary.reconcileCalls.length).toBe(1);
  });

  test("ineligible extension falls back to conflict resolver without calling reconcile", async () => {
    const { primary, secondary, snapshot, sync } = createReconcileSyncSetup();

    await primary.writeFile("image.png", encode("base binary"));
    await doSync(sync, snapshot);

    await primary.writeFile("image.png", encode("primary binary edit"));
    secondary.failNextWrite = true;

    await doSync(sync, snapshot);

    expect(secondary.reconcileCalls.length).toBe(0);
    const files = await primary.fetchFileList();
    expect(files.some((f) => f.name.includes(".conflicted-"))).toBe(true);
  });

  test("missing base entry falls back to conflict resolver without calling reconcile", async () => {
    const { primary, secondary, snapshot, sync } = createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("base content"));
    await doSync(sync, snapshot);

    // Simulate a legacy snapshot with no base recorded
    snapshot.baseHashes.delete("doc.md");

    await primary.writeFile("doc.md", encode("primary edit"));
    secondary.failNextWrite = true;

    await doSync(sync, snapshot);

    expect(secondary.reconcileCalls.length).toBe(0);
    const files = await primary.fetchFileList();
    expect(files.some((f) => f.name.includes(".conflicted-"))).toBe(true);
  });

  test("both-changed (no 412) also reconciles when base is available", async () => {
    const { primary, secondary, snapshot, sync } = createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("base content"));
    await doSync(sync, snapshot);

    // Diverge both sides without triggering a write 412: primary changes,
    // and secondary's underlying content changes directly (bypassing the
    // stub's write-conditional tracking), producing a "changed on both
    // ends" state on the next sync pass.
    await sleep(10);
    await primary.writeFile("doc.md", encode("local edit"));
    await sleep(10);
    await secondary.writeFile("doc.md", encode("remote edit"));

    secondary.reconcileResponse = {
      status: "merged",
      revision: {
        algorithm: "sha256",
        hash: "server-remote-hash",
        size: 11,
        lastModified: 88888,
      },
      text: "merged text",
    };

    await doSync(sync, snapshot);

    expect(secondary.reconcileCalls.length).toBe(1);
    expect(decode((await primary.readFile("doc.md")).data)).toBe("merged text");
  });

  test("safety entry written when proposed differs from both base and result", async () => {
    const { primary, secondary, snapshot, sync, baseStore } =
      createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("base content"));
    await doSync(sync, snapshot);

    await primary.writeFile("doc.md", encode("local edit"));
    secondary.failNextWrite = true;
    secondary.reconcileResponse = {
      status: "merged",
      revision: {
        algorithm: "sha256",
        hash: "server-remote-hash",
        size: 11,
        lastModified: 99999,
      },
      text: "merged text",
    };

    await doSync(sync, snapshot);

    const proposedHash = await hashSHA256(encode("local edit"));
    expect(await baseStore.getBase(proposedHash)).toBeNull();
    const safetyKey = ["$sync", "safety", proposedHash];
    // deno-lint-ignore no-explicit-any
    const stored = (baseStore as any).kv;
    const [entry] = await stored.batchGet([safetyKey]);
    expect(entry).toBeDefined();
    expect(entry.data).toEqual(encode("local edit"));
  });

  test("std-lib paths are never reconciled", async () => {
    const { primary, secondary, snapshot, sync } = createReconcileSyncSetup();

    await primary.writeFile("Library/Std/doc.md", encode("base content"));
    await doSync(sync, snapshot);

    await primary.writeFile("Library/Std/doc.md", encode("local edit"));
    secondary.failNextWrite = true;

    await doSync(sync, snapshot);

    expect(secondary.reconcileCalls.length).toBe(0);
  });

  test("ineligible (409/413) reconcile response falls back to legacy resolver without latching unsupported", async () => {
    const { primary, secondary, snapshot, sync } = createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("base content"));
    await doSync(sync, snapshot);

    await primary.writeFile("doc.md", encode("primary edit"));
    secondary.failNextWrite = true;
    secondary.reconcileResponse = "ineligible";

    await doSync(sync, snapshot);

    expect(secondary.reconcileCalls.length).toBe(1);
    const files = await primary.fetchFileList();
    expect(files.some((f) => f.name.includes(".conflicted-"))).toBe(true);

    // A second 412 should still attempt reconciliation: 409/413 is
    // path-specific ineligibility, not "server doesn't support reconcile"
    // (that's only a null response), so it must not latch.
    await primary.writeFile("doc.md", encode("primary edit 2"));
    secondary.failNextWrite = true;
    secondary.reconcileResponse = "ineligible";
    await doSync(sync, snapshot);

    expect(secondary.reconcileCalls.length).toBe(2);
  });

  test("transport error during reconcile falls back to legacy resolver without latching unsupported, and doesn't abort the rest of the sync cycle", async () => {
    const { primary, secondary, snapshot, sync } = createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("base content"));
    await doSync(sync, snapshot);

    await primary.writeFile("doc.md", encode("primary edit"));
    await primary.writeFile("other.md", encode("brand new file"));
    // Both files are pushed in the same cycle, so the 412 has to be pinned to
    // the one this test is about.
    secondary.failNextWritePath = "doc.md";
    secondary.failNextWrite = true;
    secondary.reconcileResponse = "transport-error";

    const ops = await doSync(sync, snapshot);
    expect(ops).toBeGreaterThan(0);

    expect(secondary.reconcileCalls.length).toBe(1);
    const files = await primary.fetchFileList();
    expect(files.some((f) => f.name.includes(".conflicted-"))).toBe(true);
    // The independent new file in the same cycle still made it across,
    // proving the uncaught transport error didn't abort the whole cycle.
    expect(decode((await secondary.readFile("other.md")).data)).toBe(
      "brand new file",
    );

    await primary.writeFile("doc.md", encode("primary edit 2"));
    secondary.failNextWrite = true;
    secondary.reconcileResponse = "transport-error";
    await doSync(sync, snapshot);

    expect(secondary.reconcileCalls.length).toBe(2);
  });

  test("retry and local-advanced outcomes return >0 ops so the snapshot gets persisted", async () => {
    const { primary, secondary, snapshot, sync } = createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("base content"));
    await doSync(sync, snapshot);

    await primary.writeFile("doc.md", encode("local edit"));
    secondary.failNextWrite = true;
    secondary.reconcileResponse = {
      status: "retry",
      revision: {
        algorithm: "sha256",
        hash: "retry-hash",
        size: 5,
        lastModified: 12345,
      },
    };

    const retryOps = await doSync(sync, snapshot);
    expect(retryOps).toBeGreaterThan(0);

    await primary.writeFile("doc.md", encode("local edit 2"));
    secondary.failNextWrite = true;
    secondary.reconcileResponse = {
      status: "merged",
      revision: {
        algorithm: "sha256",
        hash: "server-remote-hash",
        size: 11,
        lastModified: 22222,
      },
      text: "merged text",
    };
    secondary.reconcileHook = async () => {
      await primary.writeFile("doc.md", encode("even newer local edit"));
    };

    const localAdvancedOps = await doSync(sync, snapshot);
    expect(localAdvancedOps).toBeGreaterThan(0);
  });

  test("local-advanced with no existing snapshot.files entry leaves the entry absent (next cycle reconverges)", async () => {
    const { primary, secondary, snapshot, sync } = createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("base content"));
    await doSync(sync, snapshot);

    // Simulate a resync scenario: base is still on record, but there's no
    // files entry (e.g. a partially rebuilt snapshot).
    snapshot.files.delete("doc.md");

    await sleep(10);
    await primary.writeFile("doc.md", encode("local edit"));
    await sleep(10);
    await secondary.writeFile("doc.md", encode("remote edit"));

    secondary.reconcileResponse = {
      status: "merged",
      revision: {
        algorithm: "sha256",
        hash: "server-remote-hash",
        size: 11,
        lastModified: 77777,
      },
      text: "merged text",
    };
    secondary.reconcileHook = async () => {
      await primary.writeFile("doc.md", encode("even newer local edit"));
    };

    await doSync(sync, snapshot);

    expect(secondary.reconcileCalls.length).toBe(1);
    // No prior entry means the "remote slot only" update has nothing to
    // attach to, so the path stays absent from snapshot.files; the next
    // cycle will see it as changed on both ends again and reconcile fresh.
    expect(snapshot.files.has("doc.md")).toBe(false);
  });

  test("primary file deleted mid-flight is treated as local-advanced: no throw, no local write, base becomes proposed", async () => {
    const { primary, secondary, snapshot, sync, baseStore, resyncedPaths } =
      createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("base content"));
    await doSync(sync, snapshot);

    await primary.writeFile("doc.md", encode("local edit"));
    secondary.failNextWrite = true;
    secondary.reconcileResponse = {
      status: "merged",
      revision: {
        algorithm: "sha256",
        hash: "server-remote-hash",
        size: 11,
        lastModified: 99999,
      },
      text: "merged text",
    };
    secondary.reconcileHook = async () => {
      // Simulate the file being deleted locally while reconciliation is
      // in flight (e.g. the user deleted the note).
      await primary.deleteFile("doc.md");
    };

    // Should not throw despite the post-response re-read of primary
    // finding the file gone.
    const ops = await doSync(sync, snapshot);
    expect(ops).toBeGreaterThan(0);

    // No local write happened: the file stays deleted (reconciliation
    // result was not resurrected onto primary).
    await expect(primary.getFileMeta("doc.md")).rejects.toThrow();

    const proposedHash = await hashSHA256(encode("local edit"));
    expect(snapshot.baseHashes.get("doc.md")).toBe(proposedHash);
    expect(await baseStore.getBase(proposedHash)).toEqual(encode("local edit"));
    expect(snapshot.remoteHashes.get("doc.md")).toBe(
      serverHash(encode("base content")),
    );
    expect(resyncedPaths).toContain("doc.md");
  });
});

// =================================================================
// A revision-capable remote is never mutated unconditionally just because
// this replica happens to have no hash recorded for the path.
// =================================================================

describe("Missing revision fails closed", () => {
  test("push pre-reads the revision when the remote is capable but the entry is missing", async () => {
    const { primary, secondary, snapshot, sync } = createConditionalSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await primary.writeFile("keeper.md", encode("keep"));
    await doSync(sync, snapshot);
    // One entry lost (a v1 snapshot, a proxy that stripped one ETag); the
    // remaining entry still proves the remote reports revisions.
    snapshot.remoteHashes.delete("doc.md");
    secondary.readWithHashCalls.length = 0;

    await primary.writeFile("doc.md", encode("v2"));
    await doSync(sync, snapshot);

    expect(secondary.readWithHashCalls).toEqual(["doc.md"]);
    const push = secondary.writeCalls.filter((c) => c.path === "doc.md").at(-1);
    expect(push?.precondition).toEqual({
      type: "matchesHash",
      hash: serverHash(encode("v1")),
    });
    expect(decode((await secondary.readFile("doc.md")).data)).toBe("v2");
  });

  test("push whose pre-read finds the remote copy gone creates conditionally", async () => {
    const { primary, secondary, snapshot, sync } = createConditionalSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await primary.writeFile("keeper.md", encode("keep"));
    await doSync(sync, snapshot);
    snapshot.remoteHashes.delete("doc.md");
    secondary.readWithHashHook = async (path) => {
      if (path === "doc.md") {
        secondary.readWithHashHook = undefined;
        await secondary.inner.deleteFile("doc.md");
      }
    };

    await primary.writeFile("doc.md", encode("v2"));
    await doSync(sync, snapshot);

    const push = secondary.writeCalls.filter((c) => c.path === "doc.md").at(-1);
    expect(push?.precondition).toEqual({ type: "notExists" });
    expect(decode((await secondary.readFile("doc.md")).data)).toBe("v2");
  });

  test("delete pre-reads the revision when the remote is capable but the entry is missing", async () => {
    const { primary, secondary, snapshot, sync } = createConditionalSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await primary.writeFile("keeper.md", encode("keep"));
    await doSync(sync, snapshot);
    snapshot.remoteHashes.delete("doc.md");
    secondary.readWithHashCalls.length = 0;
    secondary.deleteCalls.length = 0;

    await primary.deleteFile("doc.md");
    await doSync(sync, snapshot);

    expect(secondary.readWithHashCalls).toEqual(["doc.md"]);
    expect(secondary.deleteCalls).toEqual([
      { path: "doc.md", expectedHash: serverHash(encode("v1")) },
    ]);
    await expect(secondary.readFile("doc.md")).rejects.toThrow();
  });

  test("delete is unconditional when the remote never reported a revision", async () => {
    const { primary, secondary, snapshot, sync } = createConditionalSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await doSync(sync, snapshot);
    snapshot.remoteHashes.clear();
    secondary.readWithHashCalls.length = 0;
    secondary.deleteCalls.length = 0;

    await primary.deleteFile("doc.md");
    await doSync(sync, snapshot);

    expect(secondary.readWithHashCalls).toEqual([]);
    expect(secondary.deleteCalls).toEqual([
      { path: "doc.md", expectedHash: undefined },
    ]);
  });

  test("delete whose pre-read finds the file already gone skips the remote call", async () => {
    const { primary, secondary, snapshot, sync } = createConditionalSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await primary.writeFile("keeper.md", encode("keep"));
    await doSync(sync, snapshot);
    snapshot.remoteHashes.delete("doc.md");
    secondary.deleteCalls.length = 0;
    secondary.readWithHashHook = async (path) => {
      if (path === "doc.md") {
        secondary.readWithHashHook = undefined;
        await secondary.inner.deleteFile("doc.md");
      }
    };

    await primary.deleteFile("doc.md");
    await doSync(sync, snapshot);

    expect(secondary.deleteCalls).toEqual([]);
    expect(snapshot.files.has("doc.md")).toBe(false);
    expect(snapshot.remoteHashes.has("doc.md")).toBe(false);
    expect(await doSync(sync, snapshot)).toBe(0);
  });
});

// =================================================================
// The legacy (non-reconciling) resolver must be safe against a live remote:
// idempotent per side, and never clobbering bytes it didn't inspect.
// =================================================================

describe("Legacy conflict resolver safety", () => {
  async function diverged() {
    const setup = createConditionalSyncSetup();
    await setup.primary.writeFile("doc.md", encode("primary version"));
    await setup.secondary.inner.writeFile(
      "doc.md",
      encode("secondary version"),
    );
    const hash8 = (await hashSHA256(encode("secondary version"))).slice(0, 8);
    return { ...setup, copyName: `doc.conflicted-${hash8}.md` };
  }

  const resolve = (
    primary: DataStoreSpacePrimitives,
    snapshot: SyncSnapshot,
    secondary: ConditionalSecondaryStub,
    // deno-lint-ignore no-explicit-any
  ) =>
    SpaceSync.primaryConflictResolver(
      "doc.md",
      snapshot,
      primary,
      secondary as any,
    );

  test("conflict copy present only on the primary is still written to the secondary", async () => {
    const { primary, secondary, snapshot, copyName } = await diverged();
    await primary.writeFile(copyName, encode("secondary version"));

    await resolve(primary, snapshot, secondary);

    expect(decode((await secondary.readFile(copyName)).data)).toBe(
      "secondary version",
    );
  });

  test("conflict copy present only on the secondary is still written to the primary", async () => {
    const { primary, secondary, snapshot, copyName } = await diverged();
    await secondary.inner.writeFile(copyName, encode("secondary version"));

    await resolve(primary, snapshot, secondary);

    expect(decode((await primary.readFile(copyName)).data)).toBe(
      "secondary version",
    );
  });

  test("canonical write carries if-match on the revision it inspected", async () => {
    const { primary, secondary, snapshot } = await diverged();

    await resolve(primary, snapshot, secondary);

    const canonical = secondary.writeCalls
      .filter((c) => c.path === "doc.md")
      .at(-1);
    expect(canonical?.precondition).toEqual({
      type: "matchesHash",
      hash: serverHash(encode("secondary version")),
    });
    expect(decode((await secondary.readFile("doc.md")).data)).toBe(
      "primary version",
    );
  });

  test("canonical write is skipped when the local file changed mid-resolution", async () => {
    const { primary, secondary, snapshot } = await diverged();
    snapshot.files.set("doc.md", [1, 1]);
    secondary.readWithHashHook = async () => {
      secondary.readWithHashHook = undefined;
      await primary.writeFile("doc.md", encode("user typed more"));
    };

    await resolve(primary, snapshot, secondary);

    expect(decode((await secondary.readFile("doc.md")).data)).toBe(
      "secondary version",
    );
    expect(decode((await primary.readFile("doc.md")).data)).toBe(
      "user typed more",
    );
    expect(snapshot.files.has("doc.md")).toBe(false);
  });

  test("a 412 on the canonical write leaves the remote alone and re-marks the path dirty", async () => {
    const { primary, secondary, snapshot, copyName } = await diverged();
    // Copy already on both sides, so the only conditional write in this
    // resolution is the canonical one.
    await primary.writeFile(copyName, encode("secondary version"));
    await secondary.inner.writeFile(copyName, encode("secondary version"));
    snapshot.files.set("doc.md", [1, 1]);
    snapshot.remoteHashes.set("doc.md", "stale");
    secondary.failNextWritePath = "doc.md";
    secondary.failNextWrite = true;

    await resolve(primary, snapshot, secondary);

    expect(decode((await secondary.readFile("doc.md")).data)).toBe(
      "secondary version",
    );
    expect(snapshot.files.has("doc.md")).toBe(false);
    expect(snapshot.remoteHashes.has("doc.md")).toBe(false);
  });
});

describe("Deferred conflict resolution", () => {
  test("no merge base is recorded when the resolver defers", async () => {
    const { primary, secondary, snapshot, sync } = createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await doSync(sync, snapshot);
    // No base entry, so the 412 falls through to the legacy resolver.
    snapshot.baseHashes.delete("doc.md");

    await primary.writeFile("doc.md", encode("primary edit"));
    secondary.failNextWritePath = "doc.md";
    secondary.failNextWrite = true;
    secondary.readWithHashHook = async () => {
      secondary.readWithHashHook = undefined;
      await primary.writeFile("doc.md", encode("user typed more"));
    };

    await doSync(sync, snapshot);

    expect(snapshot.files.has("doc.md")).toBe(false);
    expect(snapshot.baseHashes.has("doc.md")).toBe(false);
    expect(decode((await secondary.readFile("doc.md")).data)).toBe("v1");
  });
});

/**
 * A pull decides "remote changed, local didn't" from state read earlier in
 * the cycle, then awaits a full round trip fetching the remote bytes. A local
 * save landing in that window must not be written over.
 */
describe("Pull adoption safety", () => {
  test("a local write landing mid-pull is not clobbered", async () => {
    const { primary, secondary, snapshot, sync, resyncedPaths } =
      createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("base"));
    await doSync(sync, snapshot);

    await secondary.inner.writeFile("doc.md", encode("remote edit"));
    secondary.readWithHashHook = async () => {
      secondary.readWithHashHook = undefined;
      await primary.writeFile("doc.md", encode("local edit"));
    };

    await doSync(sync, snapshot);

    expect(decode((await primary.readFile("doc.md")).data)).toBe("local edit");
    expect(resyncedPaths).toContain("doc.md");

    // The next cycle sees both sides changed and resolves them, keeping the
    // remote revision as a conflict copy rather than dropping either one.
    await doSync(sync, snapshot);
    const hash8 = (await hashSHA256(encode("remote edit"))).slice(0, 8);
    expect(
      decode((await primary.readFile(`doc.conflicted-${hash8}.md`)).data),
    ).toBe("remote edit");
    expect(decode((await primary.readFile("doc.md")).data)).toBe("local edit");
    expect(decode((await secondary.readFile("doc.md")).data)).toBe(
      "local edit",
    );
  });

  test("a local creation landing mid-pull is not clobbered", async () => {
    const { primary, secondary, snapshot, sync, resyncedPaths } =
      createReconcileSyncSetup();

    await secondary.inner.writeFile("new.md", encode("remote"));
    secondary.readWithHashHook = async () => {
      secondary.readWithHashHook = undefined;
      await primary.writeFile("new.md", encode("local creation"));
    };

    await doSync(sync, snapshot);

    expect(decode((await primary.readFile("new.md")).data)).toBe(
      "local creation",
    );
    expect(snapshot.files.has("new.md")).toBe(false);
    expect(resyncedPaths).toContain("new.md");

    await doSync(sync, snapshot);
    const hash8 = (await hashSHA256(encode("remote"))).slice(0, 8);
    expect(
      decode((await primary.readFile(`new.conflicted-${hash8}.md`)).data),
    ).toBe("remote");
    expect(decode((await primary.readFile("new.md")).data)).toBe(
      "local creation",
    );
  });

  test("a local recreation landing mid delete-repull is not clobbered", async () => {
    const { primary, secondary, snapshot, sync, resyncedPaths } =
      createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await doSync(sync, snapshot);

    await primary.deleteFile("doc.md");
    await secondary.inner.writeFile("doc.md", encode("remote edit"));
    secondary.failNextDelete = true;
    secondary.readWithHashHook = async () => {
      secondary.readWithHashHook = undefined;
      await primary.writeFile("doc.md", encode("recreated locally"));
    };
    const suppressed: string[] = [];
    sync.on({
      suppressedDeletion: (path) => {
        suppressed.push(path);
      },
    });

    await doSync(sync, snapshot);

    expect(decode((await primary.readFile("doc.md")).data)).toBe(
      "recreated locally",
    );
    expect(resyncedPaths).toContain("doc.md");
    // Nothing was suppressed: the pull never happened.
    expect(suppressed).toEqual([]);
  });

  // A pull that legitimately proceeds still displaces whatever the local copy
  // held. When those bytes aren't the base both sides agreed on, they are
  // recoverable from the safety cache rather than gone. Reaching that at all
  // takes a remote that reports no revisions: with one, the same drift is
  // caught before the pull (see "Same-millisecond divergence") rather than
  // displaced.
  test("a pull over non-base local bytes keeps a safety copy", async () => {
    const { primary, secondary, snapshot, sync, baseStore } =
      createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await doSync(sync, snapshot);

    // Local content drifted from the recorded base without the sync engine
    // seeing it (the snapshot still claims local is untouched).
    const localMeta = await primary.writeFile(
      "doc.md",
      encode("unrecorded local work"),
    );
    snapshot.files.set("doc.md", [
      localMeta.lastModified,
      snapshot.files.get("doc.md")![1],
    ]);
    snapshot.remoteHashes.clear();
    await secondary.inner.writeFile("doc.md", encode("v2"));

    await doSync(sync, snapshot);

    expect(decode((await primary.readFile("doc.md")).data)).toBe("v2");
    const safety = await baseStore.getSafety(
      await hashSHA256(encode("unrecorded local work")),
    );
    expect(safety && decode(safety)).toBe("unrecorded local work");
  });

  // The same drift against a revision-reporting remote: the local copy no
  // longer hashes to the revision last synced, so the pull's "local didn't
  // change" premise is false and the edit must not be displaced at all.
  test("a pull over an unsynced local edit resolves instead of clobbering", async () => {
    const { primary, secondary, snapshot, sync } = createConditionalSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await doSync(sync, snapshot);

    const localMeta = await primary.writeFile(
      "doc.md",
      encode("unsynced local work"),
    );
    snapshot.files.set("doc.md", [
      localMeta.lastModified,
      snapshot.files.get("doc.md")![1],
    ]);
    await secondary.inner.writeFile("doc.md", encode("v2"));

    await doSync(sync, snapshot);

    expect(decode((await primary.readFile("doc.md")).data)).toBe(
      "unsynced local work",
    );
    const conflictName = `doc.conflicted-${(
      await hashSHA256(encode("v2"))
    ).slice(0, 8)}.md`;
    expect(decode((await primary.readFile(conflictName)).data)).toBe("v2");
    expect(decode((await secondary.readFile("doc.md")).data)).toBe(
      "unsynced local work",
    );
  });

  test("a pull over the agreed base keeps no safety copy", async () => {
    const { primary, secondary, snapshot, sync, baseStore } =
      createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("v1"));
    await doSync(sync, snapshot);
    await secondary.inner.writeFile("doc.md", encode("v2"));

    await doSync(sync, snapshot);

    expect(decode((await primary.readFile("doc.md")).data)).toBe("v2");
    expect(await baseStore.listSafety()).toEqual([]);
  });
  test("a mid-pull write with repeated metadata is still caught", async () => {
    // Finding #4: two writes in the same millisecond at the same size are
    // indistinguishable by metadata. The guard must not depend on that.
    const { primary, secondary, snapshot, sync, resyncedPaths } =
      createReconcileSyncSetup();

    await primary.writeFile("doc.md", encode("aaaa"));
    await doSync(sync, snapshot);

    await secondary.inner.writeFile("doc.md", encode("remote edit"));
    // Copied, not aliased: the store hands back the live meta object it
    // mutates on write.
    const staleMeta = { ...(await primary.getFileMeta("doc.md")) };
    secondary.readWithHashHook = async () => {
      secondary.readWithHashHook = undefined;
      await primary.writeFile("doc.md", encode("bbbb"));
      // Metadata that repeats: same size, and a lastModified the racing
      // write landed inside of.
      primary.getFileMeta = () => Promise.resolve(staleMeta);
    };

    await doSync(sync, snapshot);

    expect(decode((await primary.readFile("doc.md")).data)).toBe("bbbb");
    expect(resyncedPaths).toContain("doc.md");
  });
});

/**
 * Finding #4: two writes to one path in the same millisecond with the same
 * byte length are indistinguishable to the scan's (lastModified, size)
 * classification, which then calls the path unchanged on both sides and never
 * syncs it again. Where an explicit signal says something did happen, the
 * classification is verified against content once instead.
 */
describe("Same-millisecond divergence", () => {
  const BASE = "anchor alpha  tail";
  const LOCAL_EDIT = "anchor bravo  tail";
  const REMOTE_EDIT = "anchor delta  tail";
  const sameMs = 1787220275955;

  /**
   * Both sides at the same millisecond and byte length, with `recorded` as the
   * revision this replica last agreed with the remote on.
   */
  async function colliding(local: string, remote: string, recorded: string) {
    expect(local.length).toBe(remote.length);
    const setup = createConditionalSyncSetup();
    await setup.primary.writeFile("note.md", encode(local), {
      name: "note.md",
      lastModified: sameMs,
      created: sameMs,
      contentType: "text/markdown",
      size: local.length,
      perm: "rw",
    });
    await setup.secondary.inner.writeFile("note.md", encode(remote), {
      name: "note.md",
      lastModified: sameMs,
      created: sameMs,
      contentType: "text/markdown",
      size: remote.length,
      perm: "rw",
    });
    setup.snapshot.files.set("note.md", [sameMs, sameMs]);
    setup.snapshot.remoteHashes.set("note.md", serverHash(encode(recorded)));
    return setup;
  }

  // The local subset: an editor save landing in the same millisecond as the
  // revision the engine recorded, with the same byte length.
  test("a locally signalled path that drifted is pushed", async () => {
    const { secondary, snapshot, sync } = await colliding(
      LOCAL_EDIT,
      BASE,
      BASE,
    );

    const ops = await sync.syncSingleFile("note.md", snapshot, {
      type: "changed",
    });

    expect(ops).toBe(1);
    expect(decode((await secondary.readFile("note.md")).data)).toBe(LOCAL_EDIT);
    expect(snapshot.remoteHashes.get("note.md")).toBe(
      serverHash(encode(LOCAL_EDIT)),
    );
  });

  // The remote subset: the local copy is exactly the revision last synced, and
  // the remote moved on at the same millisecond and length. Only the revision
  // the change event reports can tell.
  test("a remotely signalled path that moved is pulled", async () => {
    const { primary, snapshot, sync } = await colliding(
      BASE,
      REMOTE_EDIT,
      BASE,
    );

    const ops = await sync.syncSingleFile("note.md", snapshot, {
      type: "remoteRevision",
      hash: serverHash(encode(REMOTE_EDIT)),
    });

    expect(ops).toBe(1);
    expect(decode((await primary.readFile("note.md")).data)).toBe(REMOTE_EDIT);
  });

  // Both sides moved inside the same millisecond: neither may be dropped, so
  // this routes through conflict resolution.
  test("a signalled path that moved on both ends is resolved", async () => {
    const { primary, secondary, snapshot, sync } = await colliding(
      LOCAL_EDIT,
      REMOTE_EDIT,
      BASE,
    );

    await sync.syncSingleFile("note.md", snapshot, {
      type: "remoteRevision",
      hash: serverHash(encode(REMOTE_EDIT)),
    });

    const conflictName = `note.conflicted-${serverHash(
      encode(REMOTE_EDIT),
    ).slice(0, 8)}.md`;
    expect(decode((await primary.readFile(conflictName)).data)).toBe(
      REMOTE_EDIT,
    );
    expect(decode((await primary.readFile("note.md")).data)).toBe(LOCAL_EDIT);
    expect(decode((await secondary.readFile("note.md")).data)).toBe(LOCAL_EDIT);
  });

  // The verification is a check, not a push: a signal for a path that
  // genuinely didn't move must stay a no-op.
  test("a signalled path that did not move stays a no-op", async () => {
    const { primary, secondary, snapshot, sync } = await colliding(
      BASE,
      BASE,
      BASE,
    );

    const ops = await sync.syncSingleFile("note.md", snapshot, {
      type: "changed",
    });

    expect(ops).toBe(0);
    expect(decode((await primary.readFile("note.md")).data)).toBe(BASE);
    expect(decode((await secondary.readFile("note.md")).data)).toBe(BASE);
  });

  // A remote signal reporting the revision already recorded says nothing
  // happened remotely, and says nothing about the local copy either.
  test("a remote signal repeating the recorded revision stays a no-op", async () => {
    const { secondary, snapshot, sync } = await colliding(BASE, BASE, BASE);

    const ops = await sync.syncSingleFile("note.md", snapshot, {
      type: "remoteRevision",
      hash: serverHash(encode(BASE)),
    });

    expect(ops).toBe(0);
    expect(decode((await secondary.readFile("note.md")).data)).toBe(BASE);
  });

  // Unsignalled traversal (the periodic scan) is deliberately left as it was:
  // it can't afford a content check per file, so a collision nobody signalled
  // stays invisible until something does signal it.
  test("an unsignalled path is still classified by timestamps alone", async () => {
    const { secondary, snapshot, sync } = await colliding(
      LOCAL_EDIT,
      BASE,
      BASE,
    );

    const ops = await sync.syncSingleFile("note.md", snapshot);

    expect(ops).toBe(0);
    expect(decode((await secondary.readFile("note.md")).data)).toBe(BASE);
  });

  // With no revision recorded for the path, the remote's current one is read
  // (and recorded) — it's no baseline to attribute a change to, so a
  // difference only says the two sides disagree, and that is resolved.
  test("an unrecorded path reads a revision before deciding", async () => {
    const { primary, secondary, snapshot, sync } = await colliding(
      LOCAL_EDIT,
      REMOTE_EDIT,
      BASE,
    );
    snapshot.remoteHashes.delete("note.md");
    // The remote is still known to report revisions at all.
    snapshot.remoteHashes.set("other.md", serverHash(encode(BASE)));

    await sync.syncSingleFile("note.md", snapshot, { type: "changed" });

    const conflictName = `note.conflicted-${serverHash(
      encode(REMOTE_EDIT),
    ).slice(0, 8)}.md`;
    expect(decode((await primary.readFile(conflictName)).data)).toBe(
      REMOTE_EDIT,
    );
    expect(decode((await secondary.readFile("note.md")).data)).toBe(LOCAL_EDIT);
  });

  // Against a remote that reports no revisions at all there is nothing to
  // verify content against, so the timestamps stand (fails closed).
  test("a revisionless remote leaves the classification alone", async () => {
    const { secondary, snapshot, sync } = await colliding(
      LOCAL_EDIT,
      BASE,
      BASE,
    );
    snapshot.remoteHashes.clear();

    const ops = await sync.syncSingleFile("note.md", snapshot, {
      type: "changed",
    });

    expect(ops).toBe(0);
    expect(decode((await secondary.readFile("note.md")).data)).toBe(BASE);
  });

  // A remote deletion propagating over an unsynced local edit is the lossy
  // face of the same collision: "modified locally" is decided by timestamp,
  // and a save inside the recorded millisecond looks unmodified.
  test("a remote deletion does not destroy a same-millisecond local edit", async () => {
    const { primary, secondary, snapshot, sync } = await colliding(
      LOCAL_EDIT,
      BASE,
      BASE,
    );
    await secondary.inner.deleteFile("note.md");
    const suppressed: string[] = [];
    sync.on({
      suppressedDeletion: (path) => {
        suppressed.push(path);
      },
    });

    await sync.syncFiles(snapshot);

    expect(decode((await primary.readFile("note.md")).data)).toBe(LOCAL_EDIT);
    expect(decode((await secondary.readFile("note.md")).data)).toBe(LOCAL_EDIT);
    expect(suppressed).toEqual(["note.md"]);
  });
});

// The indexer uses these announcements to avoid reading files the initial
// sync hasn't delivered yet (such a read would re-download the file through
// the proxy, racing the sync engine for connections).
describe("fileSynced events", () => {
  test("every file pulled from the secondary during a cycle is announced", async () => {
    const { primary, secondary, snapshot, sync } = createSyncSetup();
    const synced: string[] = [];
    sync.on({
      fileSynced: (path: string) => {
        synced.push(path);
      },
    });
    await secondary.writeFile("a.md", encode("A"));
    await secondary.writeFile("b.md", encode("B"));
    await doSync(sync, snapshot);
    expect(synced.sort()).toEqual(["a.md", "b.md"]);
    expect((await primary.readFile("a.md")).data).toEqual(encode("A"));
  });

  test("files pushed to the secondary are not announced (already local)", async () => {
    const { primary, snapshot, sync } = createSyncSetup();
    const synced: string[] = [];
    sync.on({
      fileSynced: (path: string) => {
        synced.push(path);
      },
    });
    await primary.writeFile("local.md", encode("L"));
    await doSync(sync, snapshot);
    expect(synced).toEqual([]);
  });
});
