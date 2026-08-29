import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import { describe, expect, test } from "vitest";
import { Config } from "../config.ts";
import { EventHook } from "../plugos/hooks/event.ts";
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
