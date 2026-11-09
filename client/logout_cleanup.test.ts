import "fake-indexeddb/auto";
import { expect, test, vi } from "vitest";
import { IndexedDBKvPrimitives } from "./data/indexeddb_kv_primitives.ts";
import { deleteLocalSpaceData } from "./logout_cleanup.ts";

test("deletes SilverBullet databases directly, including open connections, and leaves unrelated data", async () => {
  const local = new IndexedDBKvPrimitives(`sb_data_${"a".repeat(64)}`);
  const unrelated = new IndexedDBKvPrimitives("unrelated-app");
  await local.init();
  await unrelated.init();
  await local.batchSet([{ key: ["note"], value: "Private draft" }]);
  await unrelated.batchSet([{ key: ["keep"], value: "Other application" }]);
  const values = new Map([
    ["silverbullet.https://notes.example/.CONFIG.md", "Private config"],
    ["sb-local-encryption-verifier:reader", "verifier"],
    ["enableEncryption", "true"],
    ["unrelated", "keep"],
  ]);
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index],
    removeItem: (key: string) => values.delete(key),
  });
  const cacheNames = new Set(["silverbullet.https://notes.example/.tooling"]);
  vi.stubGlobal("caches", {
    keys: async () => [...cacheNames],
    delete: async (name: string) => cacheNames.delete(name),
  });
  try {
    await deleteLocalSpaceData();
    expect((await indexedDB.databases()).map((db) => db.name)).not.toContain(
      `sb_data_${"a".repeat(64)}`,
    );
    expect([...cacheNames]).toEqual([]);
    expect(await unrelated.batchGet([["keep"]])).toEqual(["Other application"]);
    expect([...values]).toEqual([["unrelated", "keep"]]);
  } finally {
    local.close();
    unrelated.close();
    vi.unstubAllGlobals();
  }
});

test("blocked deletion reports failure and keeps the logout barrier for retry", async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`sb_files_${"c".repeat(64)}`);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const values = new Map([
    ["sb-logout-state", JSON.stringify({ id: "cleanup", revoked: true })],
  ]);
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index],
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
  });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const deletion = deleteLocalSpaceData();
    const rejected = expect(deletion).rejects.toThrow(
      "Local data could not be completely removed",
    );
    await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(values.has("sb-logout-state")).toBe(true);
    db.close();
    await deleteLocalSpaceData();
    expect(values.has("sb-logout-state")).toBe(false);
  } finally {
    db.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

test("a failing cache deletion still deletes the databases", async () => {
  const name = `sb_data_${"d".repeat(64)}`;
  const local = new IndexedDBKvPrimitives(name);
  await local.init();
  vi.stubGlobal("localStorage", {
    length: 0,
    key: () => null,
    removeItem: () => {},
  });
  vi.stubGlobal("caches", {
    keys: async () => {
      throw new Error("SecurityError");
    },
  });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await deleteLocalSpaceData();
    expect((await indexedDB.databases()).map((db) => db.name)).not.toContain(
      name,
    );
    expect(error).toHaveBeenCalledOnce();
  } finally {
    error.mockRestore();
    local.close();
    vi.unstubAllGlobals();
  }
});
