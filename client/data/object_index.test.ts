import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import { describe, expect, test } from "vitest";
import { Config } from "../config.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { System } from "../plugos/system.ts";
import type { EventHookT } from "@silverbulletmd/silverbullet/type/manifest";
import { LuaEnv, LuaStackFrame } from "../space_lua/runtime.ts";
import { DataStore } from "./datastore.ts";
import { MemoryKvPrimitives } from "./memory_kv_primitives.ts";
import { DataStoreMQ } from "./mq.datastore.ts";
import { ObjectIndex } from "./object_index.ts";

function makeObjectIndex(): ObjectIndex {
  const kv = new MemoryKvPrimitives();
  const ds = new DataStore(kv);
  const eventHook = new EventHook();
  const mq = new DataStoreMQ(ds, eventHook);
  const config = new Config();
  return new ObjectIndex(ds, config, eventHook, mq);
}

function makeCountingObjectIndex() {
  const kv = new MemoryKvPrimitives();
  let indexScans = 0;
  const origQuery = kv.query.bind(kv);
  kv.query = (opts: any) => {
    if (opts.prefix?.[0] === "idx") {
      indexScans++;
    }
    return origQuery(opts);
  };
  const ds = new DataStore(kv);
  const eventHook = new EventHook();
  const mq = new DataStoreMQ(ds, eventHook);
  const config = new Config();
  const objectIndex = new ObjectIndex(ds, config, eventHook, mq);
  return { objectIndex, indexScans: () => indexScans };
}

function pageObject(ref: string): ObjectValue<any> {
  return { ref, tag: "page", name: ref, extra: "x" } as ObjectValue<any>;
}

async function queryPages(objectIndex: ObjectIndex): Promise<any[]> {
  return objectIndex.queryLuaObjects(new LuaEnv(), "page", {});
}

describe("ObjectIndex scan memoization", () => {
  test("repeated queries within the memo window scan the store once", async () => {
    const { objectIndex, indexScans } = makeCountingObjectIndex();
    await objectIndex.indexObjects("TestPage", [pageObject("a")]);
    const before = indexScans();
    await queryPages(objectIndex);
    await queryPages(objectIndex);
    await objectIndex
      .objectsWithTag("page")
      .query({}, new LuaEnv(), LuaStackFrame.lostFrame);
    expect(indexScans()).toBe(before + 1);
  });

  test("callers get isolated copies, not shared objects", async () => {
    const { objectIndex } = makeCountingObjectIndex();
    await objectIndex.indexObjects("TestPage", [pageObject("a")]);
    const first = await queryPages(objectIndex);
    first[0].name = "MUTATED";
    const second = await queryPages(objectIndex);
    expect(second[0].name).toBe("a");
  });

  test("an index write invalidates the memo", async () => {
    const { objectIndex } = makeCountingObjectIndex();
    await objectIndex.indexObjects("TestPage", [pageObject("a")]);
    expect((await queryPages(objectIndex)).length).toBe(1);
    await objectIndex.indexObjects("OtherPage", [pageObject("b")]);
    expect((await queryPages(objectIndex)).length).toBe(2);
  });

  test("clearing a file's index invalidates the memo", async () => {
    const { objectIndex } = makeCountingObjectIndex();
    await objectIndex.indexObjects("TestPage", [pageObject("a")]);
    expect((await queryPages(objectIndex)).length).toBe(1);
    await objectIndex.clearFileIndex("TestPage.md");
    expect((await queryPages(objectIndex)).length).toBe(0);
  });

  test("the memo expires after its TTL", async () => {
    const { objectIndex, indexScans } = makeCountingObjectIndex();
    objectIndex.scanMemoTTLMs = 5;
    await objectIndex.indexObjects("TestPage", [pageObject("a")]);
    const before = indexScans();
    await queryPages(objectIndex);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await queryPages(objectIndex);
    expect(indexScans()).toBe(before + 2);
  });
});

function makeClearScanCounter() {
  const kv = new MemoryKvPrimitives();
  let clearScans = 0;
  const origQuery = kv.query.bind(kv);
  kv.query = (opts: any) => {
    if (opts.prefix?.[0] === "ridx") {
      clearScans++;
    }
    return origQuery(opts);
  };
  const ds = new DataStore(kv);
  const eventHook = new EventHook();
  const mq = new DataStoreMQ(ds, eventHook);
  const config = new Config();
  const makeIndex = () => new ObjectIndex(ds, config, eventHook, mq);
  return { makeIndex, clearScans: () => clearScans };
}

function makeFreshSetup() {
  const kv = new MemoryKvPrimitives();
  const ds = new DataStore(kv);
  const eventHook = new EventHook();
  const system = new System<EventHookT>(undefined);
  system.addHook(eventHook);
  const mq = new DataStoreMQ(ds, eventHook);
  const config = new Config();
  const objectIndex = new ObjectIndex(ds, config, eventHook, mq);
  return { objectIndex, eventHook, mq };
}

function fileMeta(name: string) {
  return {
    name,
    lastModified: 1,
    created: 1,
    contentType: "text/markdown",
    size: 0,
    perm: "rw",
  };
}

// The initial index only counts as complete when it actually covers the
// listed space. Without this, an interrupted first boot (snapshot saved,
// queue half-drained) or messages dropped after repeated failures would mark
// a silently incomplete index as done.
describe("ObjectIndex initial-index completion verification", () => {
  test("completion is withheld and gaps re-queued until every listed page is indexed", async () => {
    const { objectIndex, eventHook, mq } = makeFreshSetup();
    await new Promise((r) => setTimeout(r, 0));
    await objectIndex.indexObjects("A", [pageObject("A")]);

    await eventHook.dispatchEvent("file:listed", [
      fileMeta("A.md"),
      fileMeta("B.md"),
    ]);

    expect(await objectIndex.hasFullIndexCompleted()).toBeFalsy();
    const messages = await mq.poll("indexQueue", 10);
    expect(messages.map((m) => m.body)).toEqual([{ path: "B.md" }]);

    await objectIndex.indexObjects("B", [pageObject("B")]);
    await mq.batchAck(
      "indexQueue",
      messages.map((m) => m.id),
    );
    await eventHook.dispatchEvent("mq:emptyQueue:indexQueue");
    expect(await objectIndex.hasFullIndexCompleted()).toBe(true);
  });

  test("verification gives up after three rounds instead of looping forever", async () => {
    const { objectIndex, eventHook, mq } = makeFreshSetup();
    await new Promise((r) => setTimeout(r, 0));

    const drainOnce = async () => {
      const messages = await mq.poll("indexQueue", 10);
      await mq.batchAck(
        "indexQueue",
        messages.map((m) => m.id),
      );
      await eventHook.dispatchEvent("mq:emptyQueue:indexQueue");
    };

    // "Unindexable.md" never produces index entries; each round re-queues it.
    await eventHook.dispatchEvent("file:listed", [fileMeta("Unindexable.md")]);
    await drainOnce();
    await drainOnce();
    expect(await objectIndex.hasFullIndexCompleted()).toBeFalsy();
    await drainOnce();
    expect(await objectIndex.hasFullIndexCompleted()).toBe(true);
  });
});

describe("ObjectIndex fresh-install clear fast path", () => {
  test("clearing never-indexed files skips the store scan when the index started empty", async () => {
    const { makeIndex, clearScans } = makeClearScanCounter();
    const objectIndex = makeIndex();
    await objectIndex.clearFileIndex("Never.md");
    const afterFirst = clearScans();
    await objectIndex.clearFileIndex("AlsoNever.md");
    expect(clearScans()).toBe(afterFirst);
  });

  test("clearFileIndex still removes entries for a file indexed since boot", async () => {
    const { makeIndex } = makeClearScanCounter();
    const objectIndex = makeIndex();
    await objectIndex.indexObjects("TestPage", [pageObject("a")]);
    await objectIndex.clearFileIndex("TestPage.md");
    expect(await queryPages(objectIndex)).toEqual([]);
  });

  test("clearFileIndex scans normally when the index did not start empty", async () => {
    const { makeIndex, clearScans } = makeClearScanCounter();
    const first = makeIndex();
    await first.indexObjects("TestPage", [pageObject("a")]);
    const second = makeIndex();
    // Settle the constructor's one-time emptiness probe (itself a scan)
    // before measuring.
    await second.clearFileIndex("Warmup.md");
    const before = clearScans();
    await second.clearFileIndex("Never.md");
    expect(clearScans()).toBe(before + 1);
  });

  test("the fast path ends once the full index completes", async () => {
    const { makeIndex, clearScans } = makeClearScanCounter();
    const objectIndex = makeIndex();
    await objectIndex.markFullIndexComplete();
    const before = clearScans();
    await objectIndex.clearFileIndex("Never.md");
    expect(clearScans()).toBe(before + 1);
  });
});

function relationObject(
  ref: string,
  kind: string,
  extra: Partial<ObjectValue<any>> = {},
): ObjectValue<any> {
  return {
    ref,
    tag: "relation",
    page: "TestPage",
    kind,
    from: "TestPage",
    fromTag: "page",
    to: "Target",
    toTag: "page",
    ...extra,
  };
}

async function runQuery(objectIndex: ObjectIndex, kind?: string) {
  const collection = objectIndex.relations(kind);
  return collection.query({}, new LuaEnv(), LuaStackFrame.lostFrame);
}

test("index.relations() with no kind returns all relation kinds", async () => {
  const objectIndex = makeObjectIndex();
  await objectIndex.indexObjects("TestPage", [
    relationObject("r1", "at-mention"),
    relationObject("r2", "mention"),
    relationObject("r3", "spouse"),
  ]);

  const results = await runQuery(objectIndex);
  const kinds = results.map((r: any) => r.kind).sort();
  expect(kinds).toEqual(["at-mention", "mention", "spouse"]);
});

test("index.relations(kind) filters to only matching kind", async () => {
  const objectIndex = makeObjectIndex();
  await objectIndex.indexObjects("TestPage", [
    relationObject("r1", "at-mention"),
    relationObject("r2", "mention"),
    relationObject("r3", "at-mention"),
  ]);

  const results = await runQuery(objectIndex, "at-mention");
  expect(results).toHaveLength(2);
  for (const r of results) {
    expect(r.kind).toEqual("at-mention");
  }
});

test("index.relations(kind) with an unknown kind returns an empty result", async () => {
  const objectIndex = makeObjectIndex();
  await objectIndex.indexObjects("TestPage", [
    relationObject("r1", "at-mention"),
    relationObject("r2", "mention"),
  ]);

  const results = await runQuery(objectIndex, "does-not-exist");
  expect(results).toEqual([]);
});

// The top bar shows an "Indexing" label whenever a wholesale index rebuild is
// running — first boot, manual "Space: Reindex", or a version-bump reindex.
// The latter two need an in-memory signal: fullIndexCompleted never flips
// back to false once set.
test("a manual reindex flags rebuildInProgress for its duration", async () => {
  const { objectIndex, mq } = makeFreshSetup();
  let seenDuringRebuild: boolean | undefined;
  const origAwait = mq.awaitEmptyQueue.bind(mq);
  mq.awaitEmptyQueue = async (queue: string) => {
    seenDuringRebuild = objectIndex.rebuildInProgress;
    return origAwait(queue);
  };
  const spaceStub = { deduplicatedFileList: async () => [] };
  await objectIndex.reindexSpace(spaceStub as any);
  expect(seenDuringRebuild).toBe(true);
  expect(objectIndex.rebuildInProgress).toBe(false);
});
