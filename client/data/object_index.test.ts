import { expect, test } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDBKvPrimitives } from "./indexeddb_kv_primitives.ts";
import { DataStore } from "./datastore.ts";
import { ObjectIndex } from "./object_index.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { Config } from "../config.ts";
import { DataStoreMQ } from "./mq.datastore.ts";

test("ObjectIndex batchClearFileIndexes", async () => {
  const db = new IndexedDBKvPrimitives("test-index");
  await db.init();
  const ds = new DataStore(db);
  const eventHook = new EventHook();
  const config = new Config();
  const mq = new DataStoreMQ(ds, eventHook);
  const index = new ObjectIndex(ds, config, eventHook, mq);

  // Index some test pages
  await index.batchSet("page1", [
    { key: ["tag1", "id1"], value: { name: "val1" } },
    { key: ["tag2", "id2"], value: { name: "val2" } },
  ]);
  await index.batchSet("page2", [
    { key: ["tag1", "id3"], value: { name: "val3" } },
  ]);

  // Check they are indexed
  let page1Keys = [];
  for await (const { key } of ds.query({ prefix: ["ridx", "page1"] })) {
    page1Keys.push(key);
  }
  expect(page1Keys.length).toBe(2);

  let idxKeys = [];
  for await (const { key } of ds.query({ prefix: ["idx"] })) {
    idxKeys.push(key);
  }
  // 3 indexed values
  expect(idxKeys.length).toBe(3);

  // Now clear both pages using batchClearFileIndexes (passing .md to test stripping)
  await index.batchClearFileIndexes(["page1.md", "page2.md"]);

  // Check page1 keys are gone
  page1Keys = [];
  for await (const { key } of ds.query({ prefix: ["ridx", "page1"] })) {
    page1Keys.push(key);
  }
  expect(page1Keys.length).toBe(0);

  // Check idx keys are gone
  idxKeys = [];
  for await (const { key } of ds.query({ prefix: ["idx"] })) {
    idxKeys.push(key);
  }
  expect(idxKeys.length).toBe(0);

  db.close();
});
