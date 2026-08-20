import { describe, expect, test } from "vitest";
import { MemoryKvPrimitives } from "../data/memory_kv_primitives.ts";
import { BaseStore } from "./base_store.ts";

const encode = (s: string) => new TextEncoder().encode(s);

const knownSha256Vector = {
  input: "hello",
  hash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
};

describe("BaseStore.putBase/getBase", () => {
  test("round-trips stored data", async () => {
    const store = new BaseStore(new MemoryKvPrimitives());
    const data = encode("some base content");
    const hash = await store.putBase(data);
    expect(await store.getBase(hash)).toEqual(data);
  });

  test("hash matches a known sha256 vector", async () => {
    const store = new BaseStore(new MemoryKvPrimitives());
    const hash = await store.putBase(encode(knownSha256Vector.input));
    expect(hash).toBe(knownSha256Vector.hash);
  });

  test("getBase returns null for unknown hash", async () => {
    const store = new BaseStore(new MemoryKvPrimitives());
    expect(await store.getBase("deadbeef")).toBeNull();
  });
});

describe("BaseStore.pruneBases", () => {
  test("keeps referenced blobs, removes unreferenced ones", async () => {
    const store = new BaseStore(new MemoryKvPrimitives());
    const keepHash = await store.putBase(encode("keep me"));
    const dropHash = await store.putBase(encode("drop me"));

    await store.pruneBases(new Set([keepHash]));

    expect(await store.getBase(keepHash)).toEqual(encode("keep me"));
    expect(await store.getBase(dropHash)).toBeNull();
  });
});

describe("BaseStore.listSafety/getSafety", () => {
  test("getSafety round-trips stored data", async () => {
    const store = new BaseStore(new MemoryKvPrimitives());
    const data = encode("some safety content");
    const hash = await store.putSafety(data);
    expect(await store.getSafety(hash)).toEqual(data);
  });

  test("getSafety returns null for unknown hash", async () => {
    const store = new BaseStore(new MemoryKvPrimitives());
    expect(await store.getSafety("deadbeef")).toBeNull();
  });

  test("listSafety returns entries newest-first", async () => {
    const store = new BaseStore(new MemoryKvPrimitives());
    const kv = (store as any).kv as MemoryKvPrimitives;

    async function putAt(content: string, ts: number): Promise<string> {
      const hash = await store.putSafety(encode(content));
      await kv.batchSet([
        {
          key: ["$sync", "safety", hash],
          value: { data: encode(content), ts },
        },
      ]);
      return hash;
    }

    const oldestHash = await putAt("aaa", 1000);
    const middleHash = await putAt("bbbb", 2000);
    const newestHash = await putAt("ccccc", 3000);

    const entries = await store.listSafety();
    expect(entries.map((e) => e.hash)).toEqual([
      newestHash,
      middleHash,
      oldestHash,
    ]);
    expect(entries).toEqual([
      { hash: newestHash, size: 5, ts: 3000 },
      { hash: middleHash, size: 4, ts: 2000 },
      { hash: oldestHash, size: 3, ts: 1000 },
    ]);
  });

  test("listSafety returns empty array when nothing stored", async () => {
    const store = new BaseStore(new MemoryKvPrimitives());
    expect(await store.listSafety()).toEqual([]);
  });
});

describe("BaseStore.putSafety/pruneSafety", () => {
  test("prunes entries older than maxAgeMs", async () => {
    const store = new BaseStore(new MemoryKvPrimitives());
    const dayMs = 24 * 60 * 60 * 1000;
    const now = 1_000_000_000_000;

    const oldHash = await store.putSafety(encode("old"));
    const kv = (store as any).kv as MemoryKvPrimitives;
    // Backdate the "old" entry's timestamp directly via the underlying store.
    const oldEntry = await kv.batchGet([["$sync", "safety", oldHash]]);
    await kv.batchSet([
      {
        key: ["$sync", "safety", oldHash],
        value: { data: oldEntry[0].data, ts: now - 8 * dayMs },
      },
    ]);

    const freshHash = await store.putSafety(encode("fresh"));
    const freshEntry = await kv.batchGet([["$sync", "safety", freshHash]]);
    await kv.batchSet([
      {
        key: ["$sync", "safety", freshHash],
        value: { data: freshEntry[0].data, ts: now - 1 * dayMs },
      },
    ]);

    await store.pruneSafety(7 * dayMs, 50 * 1024 * 1024, now);

    const [oldAfter, freshAfter] = await kv.batchGet([
      ["$sync", "safety", oldHash],
      ["$sync", "safety", freshHash],
    ]);
    expect(oldAfter).toBeUndefined();
    expect(freshAfter).toBeDefined();
  });

  test("prunes oldest-first when over the byte cap", async () => {
    const store = new BaseStore(new MemoryKvPrimitives());
    const now = 1_000_000_000_000;
    const kv = (store as any).kv as MemoryKvPrimitives;

    async function putAt(content: string, ts: number): Promise<string> {
      const hash = await store.putSafety(encode(content));
      await kv.batchSet([
        {
          key: ["$sync", "safety", hash],
          value: { data: encode(content), ts },
        },
      ]);
      return hash;
    }

    const oldestHash = await putAt("aaaaaaaaaa", now - 3000); // 10 bytes
    const middleHash = await putAt("bbbbbbbbbb", now - 2000); // 10 bytes
    const newestHash = await putAt("cccccccccc", now - 1000); // 10 bytes

    // Cap small enough that only the newest entry fits.
    await store.pruneSafety(365 * 24 * 60 * 60 * 1000, 15, now);

    const [oldestAfter, middleAfter, newestAfter] = await kv.batchGet([
      ["$sync", "safety", oldestHash],
      ["$sync", "safety", middleHash],
      ["$sync", "safety", newestHash],
    ]);
    expect(oldestAfter).toBeUndefined();
    expect(middleAfter).toBeUndefined();
    expect(newestAfter).toBeDefined();
  });

  test("keeps everything when under both caps", async () => {
    const store = new BaseStore(new MemoryKvPrimitives());
    const hash = await store.putSafety(encode("small"));
    await store.pruneSafety();
    expect(
      await (store as any).kv.batchGet([["$sync", "safety", hash]]),
    ).toEqual([expect.objectContaining({ data: encode("small") })]);
  });
});
