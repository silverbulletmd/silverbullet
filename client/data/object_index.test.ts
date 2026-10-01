import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import { describe, expect, test } from "vitest";
import { Config } from "../config.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { System } from "../plugos/system.ts";
import type { EventHookT } from "@silverbulletmd/silverbullet/type/manifest";
import { parseExpressionString } from "../space_lua/parse.ts";
import { luaBuildStandardEnv } from "../space_lua/stdlib.ts";
import { LuaEnv, LuaStackFrame, LuaTable } from "../space_lua/runtime.ts";
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
  const scansByTag = new Map<string, number>();
  const origQuery = kv.query.bind(kv);
  kv.query = (opts: any) => {
    if (opts.prefix?.[0] === "idx") {
      indexScans++;
      const tag = String(opts.prefix[1]);
      scansByTag.set(tag, (scansByTag.get(tag) ?? 0) + 1);
    }
    return origQuery(opts);
  };
  const ds = new DataStore(kv);
  const eventHook = new EventHook();
  const mq = new DataStoreMQ(ds, eventHook);
  const config = new Config();
  const objectIndex = new ObjectIndex(ds, config, eventHook, mq);
  return {
    objectIndex,
    config,
    kv,
    indexScans: () => indexScans,
    scansOf: (tag: string) => scansByTag.get(tag) ?? 0,
  };
}

function taskObject(ref: string, page: string): ObjectValue<any> {
  return { ref, tag: "task", page, name: ref, done: false } as ObjectValue<any>;
}

function queryWhere(
  objectIndex: ObjectIndex,
  tag: string,
  where: string,
): Promise<any[]> {
  return objectIndex.queryLuaObjects(new LuaEnv(), tag, {
    objectVariable: "_",
    where: parseExpressionString(where),
  });
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

  test("a write only invalidates the tags it touches", async () => {
    const { objectIndex, scansOf } = makeCountingObjectIndex();
    await objectIndex.indexObjects("TestPage", [pageObject("a")]);
    await queryPages(objectIndex);
    const pageScans = scansOf("page");
    await objectIndex.indexObjects("OtherPage", [
      taskObject("OtherPage@1", "OtherPage"),
    ]);
    expect((await queryPages(objectIndex)).length).toBe(1);
    expect(scansOf("page")).toBe(pageScans);
    expect(
      (await objectIndex.queryLuaObjects(new LuaEnv(), "task", {})).length,
    ).toBe(1);
  });

  test("clearing a file's index invalidates every tag the file had", async () => {
    const { objectIndex } = makeCountingObjectIndex();
    await objectIndex.indexObjects("TestPage", [
      pageObject("TestPage"),
      taskObject("TestPage@1", "TestPage"),
    ]);
    expect((await queryPages(objectIndex)).length).toBe(1);
    expect(
      (await objectIndex.queryLuaObjects(new LuaEnv(), "task", {})).length,
    ).toBe(1);
    await objectIndex.clearFileIndex("TestPage.md");
    expect((await queryPages(objectIndex)).length).toBe(0);
    expect(
      (await objectIndex.queryLuaObjects(new LuaEnv(), "task", {})).length,
    ).toBe(0);
  });

  test("a scan that overlaps a write does not memoize the pre-write rows", async () => {
    const { objectIndex, kv } = makeCountingObjectIndex();
    await objectIndex.indexObjects("TestPage", [pageObject("a")]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const origQuery = kv.query.bind(kv);
    kv.query = (opts: any) => {
      const it = origQuery(opts);
      if (opts.prefix?.[0] !== "idx" || opts.prefix?.[1] !== "page") return it;
      return (async function* () {
        const rows = [];
        for await (const row of it) rows.push(row);
        await gate;
        yield* rows;
      })();
    };
    const stale = queryPages(objectIndex);
    await new Promise((r) => setTimeout(r, 0));
    kv.query = origQuery;
    await objectIndex.indexObjects("OtherPage", [pageObject("b")]);
    release();
    await stale;
    expect((await queryPages(objectIndex)).length).toBe(2);
  });

  test("where filters over the memo without letting callers mutate it", async () => {
    const { objectIndex } = makeCountingObjectIndex();
    await objectIndex.indexObjects("TestPage", [pageObject("a")]);
    await objectIndex.indexObjects("OtherPage", [pageObject("b")]);
    const first = await queryWhere(objectIndex, "page", `_.name == "a"`);
    expect(first.map((p) => p.name)).toEqual(["a"]);
    first[0].name = "MUTATED";
    first[0].extra = "MUTATED";
    const again = await queryWhere(objectIndex, "page", `_.name == "a"`);
    expect(again.map((p) => [p.name, p.extra])).toEqual([["a", "x"]]);
    expect((await queryPages(objectIndex)).map((p) => p.name).sort()).toEqual([
      "a",
      "b",
    ]);
  });

  test("where sees a tag's metatable, and results keep it", async () => {
    const { objectIndex, config } = makeCountingObjectIndex();
    const index = new LuaTable();
    void index.set("kind", "special");
    const mt = new LuaTable();
    void mt.set("__index", index);
    config.set(["tags", "page", "metatable"], mt);
    await objectIndex.indexObjects("TestPage", [pageObject("a")]);
    await objectIndex.indexObjects("OtherPage", [pageObject("b")]);
    const results = await objectIndex.objectsWithTag("page").query(
      {
        objectVariable: "_",
        where: parseExpressionString(`_.kind == "special" and _.name == "a"`),
      },
      new LuaEnv(),
      LuaStackFrame.lostFrame,
    );
    expect(results.length).toBe(1);
    expect(results[0]).toBeInstanceOf(LuaTable);
    expect(results[0].metatable).toBe(mt);
    expect(results[0].rawGet("name")).toBe("a");
  });

  test("filtered collections combine their filter with the query's where", async () => {
    const { objectIndex } = makeCountingObjectIndex();
    await objectIndex.indexObjects("Folder/A", [pageObject("Folder/A")]);
    await objectIndex.indexObjects("Folder/B", [pageObject("Folder/B")]);
    await objectIndex.indexObjects("Other", [pageObject("Other")]);
    const results = await objectIndex.subPages("Folder").query(
      {
        objectVariable: "p",
        where: parseExpressionString(`p.name ~= "Folder/B"`),
      },
      luaBuildStandardEnv(),
      LuaStackFrame.lostFrame,
    );
    expect(results.map((p: any) => p.name)).toEqual(["Folder/A"]);
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

function makeSharedStoreIndexes() {
  const ds = new DataStore(new MemoryKvPrimitives());
  const eventHook = new EventHook();
  const mq = new DataStoreMQ(ds, eventHook);
  const config = new Config();
  return () => new ObjectIndex(ds, config, eventHook, mq);
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

  test("completion stops the round a page that can never index makes no progress", async () => {
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

    // "Unindexable.md" never produces index entries. The first round has
    // something to try, the second sees the set has not shrunk and gives up
    // rather than counting to an arbitrary limit.
    await eventHook.dispatchEvent("file:listed", [fileMeta("Unindexable.md")]);
    expect(await objectIndex.hasFullIndexCompleted()).toBeFalsy();
    await drainOnce();
    expect(await objectIndex.hasFullIndexCompleted()).toBe(true);
  });

  test("rounds keep going for as long as the missing set is shrinking", async () => {
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

    // Each round indexes one of four pages; keep retrying while the set shrinks.
    const names = ["A", "B", "C", "D"];
    await eventHook.dispatchEvent(
      "file:listed",
      names.map((n) => fileMeta(`${n}.md`)),
    );
    for (const name of names) {
      expect(await objectIndex.hasFullIndexCompleted()).toBeFalsy();
      await objectIndex.indexObjects(name, [pageObject(name)]);
      await drainOnce();
    }
    expect(await objectIndex.hasFullIndexCompleted()).toBe(true);
  });
});

describe("ObjectIndex clearFileIndex", () => {
  test("clears entries written by an earlier session, not just this one", async () => {
    const makeIndex = makeSharedStoreIndexes();
    const first = makeIndex();
    await first.indexObjects("TestPage", [pageObject("a")]);
    const second = makeIndex();
    await second.clearFileIndex("TestPage.md");
    expect(await queryPages(second)).toEqual([]);
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
