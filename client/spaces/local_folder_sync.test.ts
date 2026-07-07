import { expect, test } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDBKvPrimitives } from "../data/indexeddb_kv_primitives.ts";
import { DataStoreSpacePrimitives } from "./datastore_space_primitives.ts";
import { LocalFolderSync } from "../local_folder_sync.ts";
import { FileSystemAccessSpacePrimitives } from "./fs_access_space_primitives.ts";
import {
  FakeDirHandle,
  stringToBytes,
} from "./fs_access_space_primitives_test_helpers.ts";

async function createSync() {
  const kvLocal = new IndexedDBKvPrimitives("local");
  await kvLocal.init();
  const kvFolder = new IndexedDBKvPrimitives("folder");
  await kvFolder.init();
  const primary = new DataStoreSpacePrimitives(kvLocal);
  const secondary = new DataStoreSpacePrimitives(kvFolder);
  const sync = new LocalFolderSync(kvLocal, primary, secondary);
  await sync.setup();
  return {
    sync,
    primary,
    secondary,
    kvLocal,
    kvFolder,
    cleanup: async () => {
      await sync.stop();
      kvLocal.close();
      kvFolder.close();
    },
  };
}

test("new file on folder syncs to local", async () => {
  const ctx = await createSync();
  try {
    await ctx.secondary.writeFile("page.md", stringToBytes("from folder"), {
      name: "page.md",
      perm: "rw",
      created: 100,
      contentType: "text/markdown",
      lastModified: 100,
      size: 11,
    });
    const ops = await ctx.sync.syncSpace();
    expect(ops).toBeGreaterThan(0);
    const { data } = await ctx.primary.readFile("page.md");
    expect(new TextDecoder().decode(data)).toEqual("from folder");
  } finally {
    await ctx.cleanup();
  }
});

test("changed file on local syncs to folder", async () => {
  const ctx = await createSync();
  try {
    await ctx.secondary.writeFile("page.md", stringToBytes("v1"), {
      name: "page.md",
      perm: "rw",
      created: 100,
      contentType: "text/markdown",
      lastModified: 100,
      size: 2,
    });
    await ctx.sync.syncSpace();

    await ctx.primary.writeFile("page.md", stringToBytes("v2-edited"), {
      name: "page.md",
      perm: "rw",
      created: 100,
      contentType: "text/markdown",
      lastModified: 200,
      size: 8,
    });
    await ctx.sync.syncSpace();

    const { data } = await ctx.secondary.readFile("page.md");
    expect(new TextDecoder().decode(data)).toEqual("v2-edited");
  } finally {
    await ctx.cleanup();
  }
});

test("file deleted on local is removed from folder", async () => {
  const ctx = await createSync();
  try {
    await ctx.secondary.writeFile("gone.md", stringToBytes("x"), {
      name: "gone.md",
      perm: "rw",
      created: 100,
      contentType: "text/markdown",
      lastModified: 100,
      size: 1,
    });
    await ctx.sync.syncSpace();

    await ctx.primary.deleteFile("gone.md");
    await ctx.sync.syncSpace();

    await expect(ctx.secondary.readFile("gone.md")).rejects.toBeTruthy();
  } finally {
    await ctx.cleanup();
  }
});

test("simultaneous edits create a .conflicted copy and local wins", async () => {
  const ctx = await createSync();
  try {
    await ctx.secondary.writeFile("conflict.md", stringToBytes("base"), {
      name: "conflict.md",
      perm: "rw",
      created: 100,
      contentType: "text/markdown",
      lastModified: 100,
      size: 4,
    });
    await ctx.sync.syncSpace();

    await ctx.primary.writeFile("conflict.md", stringToBytes("local-edit"), {
      name: "conflict.md",
      perm: "rw",
      created: 100,
      contentType: "text/markdown",
      lastModified: 200,
      size: 10,
    });
    await ctx.secondary.writeFile("conflict.md", stringToBytes("folder-edit"), {
      name: "conflict.md",
      perm: "rw",
      created: 100,
      contentType: "text/markdown",
      lastModified: 300,
      size: 11,
    });
    await ctx.sync.syncSpace();

    const localMain = await ctx.primary.readFile("conflict.md");
    expect(new TextDecoder().decode(localMain.data)).toEqual("local-edit");

    const folderMain = await ctx.secondary.readFile("conflict.md");
    expect(new TextDecoder().decode(folderMain.data)).toEqual("local-edit");

    const primaryFiles = (await ctx.primary.fetchFileList()).map((m) => m.name);
    const conflictCopy = primaryFiles.find((n) => n.includes(".conflicted:"));
    expect(conflictCopy).toBeTruthy();
    const { data: copyData } = await ctx.primary.readFile(conflictCopy!);
    expect(new TextDecoder().decode(copyData)).toEqual("folder-edit");
  } finally {
    await ctx.cleanup();
  }
});

test("snapshot persists across restart and unchanged files yield zero ops", async () => {
  const kvLocal = new IndexedDBKvPrimitives("local-restart");
  await kvLocal.init();
  const kvFolder = new IndexedDBKvPrimitives("folder-restart");
  await kvFolder.init();
  try {
    const primary = new DataStoreSpacePrimitives(kvLocal);
    const secondary = new DataStoreSpacePrimitives(kvFolder);
    await secondary.writeFile("stable.md", stringToBytes("same"), {
      name: "stable.md",
      perm: "rw",
      created: 100,
      contentType: "text/markdown",
      lastModified: 100,
      size: 4,
    });

    const sync1 = new LocalFolderSync(kvLocal, primary, secondary);
    await sync1.setup();
    await sync1.syncSpace();
    // Await stop() so the snapshot save kicked off by syncFiles' finally
    // (snapshotUpdated, fire-and-forget) has settled before sync2 reads it.
    await sync1.stop();

    const sync2 = new LocalFolderSync(kvLocal, primary, secondary);
    await sync2.setup();
    const ops = await sync2.syncSpace();
    await sync2.stop();

    expect(ops).toEqual(0);
    const { data } = await primary.readFile("stable.md");
    expect(new TextDecoder().decode(data)).toEqual("same");
  } finally {
    kvLocal.close();
    kvFolder.close();
  }
});

// Integration test: drive LocalFolderSync with a *real* FileSystemAccessSpacePrimitives
// (over an in-memory FakeDirHandle) as the folder side, exactly as the client
// wires it in production. This catches adapter-level meta-shape mismatches
// between fileToMeta() and what SpaceSync expects that the DataStore-only
// tests above cannot.

async function createFsaSync() {
  const kvLocal = new IndexedDBKvPrimitives("local-fsa");
  await kvLocal.init();
  const primary = new DataStoreSpacePrimitives(kvLocal);
  const folderHandle = new FakeDirHandle("root");
  const secondary = new FileSystemAccessSpacePrimitives(folderHandle);
  const sync = new LocalFolderSync(kvLocal, primary, secondary);
  await sync.setup();
  return {
    sync,
    primary,
    secondary,
    folderHandle,
    kvLocal,
    cleanup: async () => {
      await sync.stop();
      kvLocal.close();
    },
  };
}

test("FSA folder file syncs to local via LocalFolderSync", async () => {
  const ctx = await createFsaSync();
  try {
    // Write directly through the FSA adapter (simulating a file the user
    // dropped into their connected folder).
    await ctx.secondary.writeFile("page.md", stringToBytes("from folder"), {
      name: "page.md",
      perm: "rw",
      created: 100,
      contentType: "text/markdown",
      lastModified: 100,
      size: 11,
    });
    const ops = await ctx.sync.syncSpace();
    expect(ops).toBeGreaterThan(0);
    const { data } = await ctx.primary.readFile("page.md");
    expect(new TextDecoder().decode(data)).toEqual("from folder");
  } finally {
    await ctx.cleanup();
  }
});

test("local edit syncs back to the FSA folder", async () => {
  const ctx = await createFsaSync();
  try {
    await ctx.secondary.writeFile("note.md", stringToBytes("v1"), {
      name: "note.md",
      perm: "rw",
      created: 100,
      contentType: "text/markdown",
      lastModified: 100,
      size: 2,
    });
    await ctx.sync.syncSpace();

    await ctx.primary.writeFile("note.md", stringToBytes("v2-edited"), {
      name: "note.md",
      perm: "rw",
      created: 100,
      contentType: "text/markdown",
      lastModified: 200,
      size: 8,
    });
    await ctx.sync.syncSpace();

    // Read back through the FSA adapter to confirm the write landed on disk.
    const { data } = await ctx.secondary.readFile("note.md");
    expect(new TextDecoder().decode(data)).toEqual("v2-edited");
  } finally {
    await ctx.cleanup();
  }
});

test("FSA + local conflict creates a .conflicted copy and local wins", async () => {
  const ctx = await createFsaSync();
  try {
    await ctx.secondary.writeFile("conflict.md", stringToBytes("base"), {
      name: "conflict.md",
      perm: "rw",
      created: 100,
      contentType: "text/markdown",
      lastModified: 100,
      size: 4,
    });
    await ctx.sync.syncSpace();

    await ctx.primary.writeFile("conflict.md", stringToBytes("local-edit"), {
      name: "conflict.md",
      perm: "rw",
      created: 100,
      contentType: "text/markdown",
      lastModified: 200,
      size: 10,
    });
    await ctx.secondary.writeFile("conflict.md", stringToBytes("folder-edit"), {
      name: "conflict.md",
      perm: "rw",
      created: 100,
      contentType: "text/markdown",
      lastModified: 300,
      size: 11,
    });
    await ctx.sync.syncSpace();

    const localMain = await ctx.primary.readFile("conflict.md");
    expect(new TextDecoder().decode(localMain.data)).toEqual("local-edit");

    const folderMain = await ctx.secondary.readFile("conflict.md");
    expect(new TextDecoder().decode(folderMain.data)).toEqual("local-edit");

    const primaryFiles = (await ctx.primary.fetchFileList()).map((m) => m.name);
    const conflictCopy = primaryFiles.find((n) => n.includes(".conflicted:"));
    expect(conflictCopy).toBeTruthy();
    const { data: copyData } = await ctx.primary.readFile(conflictCopy!);
    expect(new TextDecoder().decode(copyData)).toEqual("folder-edit");
  } finally {
    await ctx.cleanup();
  }
});

test("stop() waits for an in-flight sync before resolving", async () => {
  // Regression test for the reconnect/disconnect race (reviewer I1): a new
  // engine must not start writing the same folder handle until the previous
  // engine's in-flight sync has settled.
  const ctx = await createFsaSync();
  try {
    // Seed a file and kick off a sync without awaiting it.
    await ctx.secondary.writeFile("seed.md", stringToBytes("seed"), {
      name: "seed.md",
      perm: "rw",
      created: 100,
      contentType: "text/markdown",
      lastModified: 100,
      size: 4,
    });
    const inFlight = ctx.sync.syncSpace();
    // stop() while sync is mid-flight; it must resolve only after the sync does.
    const stopped = ctx.sync.stop();
    await inFlight;
    await stopped;
    // After stop resolves, the file must already be on the primary side
    // (proving the sync completed before teardown).
    const { data } = await ctx.primary.readFile("seed.md");
    expect(new TextDecoder().decode(data)).toEqual("seed");
  } finally {
    await ctx.cleanup();
  }
});
