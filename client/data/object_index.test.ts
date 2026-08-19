import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import { expect, test } from "vitest";
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
