import { expect, test } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDBKvPrimitives } from "../data/indexeddb_kv_primitives.ts";
import { DataStoreSpacePrimitives } from "./datastore_space_primitives.ts";
import { LocalFolderSync } from "../local_folder_sync.ts";

const stringToBytes = (s: string): Uint8Array => new TextEncoder().encode(s);

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
      sync.stop();
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
    sync1.stop();

    const sync2 = new LocalFolderSync(kvLocal, primary, secondary);
    await sync2.setup();
    const ops = await sync2.syncSpace();
    sync2.stop();

    expect(ops).toEqual(0);
    const { data } = await primary.readFile("stable.md");
    expect(new TextDecoder().decode(data)).toEqual("same");
  } finally {
    kvLocal.close();
    kvFolder.close();
  }
});
