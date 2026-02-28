import { expect, onTestFinished, test } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryKvPrimitives } from "./memory_kv_primitives.ts";
import { allTests } from "./kv_primitives.test.ts";

import type { KV } from "../../plug-api/types/datastore.ts";

function tempFilePath(): string {
  const path = join(tmpdir(), `test-${Date.now()}-${Math.random().toString(36)}.json`);
  onTestFinished(() => rm(path, { force: true }));
  return path;
}

test("MemoryKvPrimitives loads from non-existent file without error", async () => {
  const tempPath = tempFilePath() + "_nonexistent";
  // Disable throttling for tests
  const store = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store.init();

  // Should create an empty store
  const result = await store.batchGet([["test"]]);
  expect(result).toEqual([undefined]);
});

test("MemoryKvPrimitives passes all KvPrimitives tests", async () => {
  const tempPath = tempFilePath();
  const store = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store.init();
  await allTests(store);
  await store.close();
});

test("MemoryKvPrimitives persists and loads data", async () => {
  const tempPath = tempFilePath();

  // Create and populate first instance
  const store1 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store1.init();
  await store1.batchSet([
    { key: ["test", "key1"], value: "value1" },
    { key: ["test", "key2"], value: "value2" },
  ]);

  // Force persistence
  await store1.close();

  // Create second instance that loads from the same file
  const store2 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store2.init();

  // Check if data was loaded correctly
  const results = await store2.batchGet([["test", "key1"], ["test", "key2"]]);
  expect(results).toEqual(["value1", "value2"]);
});

test("MemoryKvPrimitives mutations trigger persistence", async () => {
  const tempPath = tempFilePath();

  // Create and populate first instance
  const store1 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store1.init();
  await store1.batchSet([{ key: ["test", "key"], value: "value" }]);

  // Create second instance without closing the first one
  const store2 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store2.init();

  // Check if data was persisted
  const results = await store2.batchGet([["test", "key"]]);
  expect(results).toEqual(["value"]);
});

test("MemoryKvPrimitives persists delete operations", async () => {
  const tempPath = tempFilePath();

  // Create and populate store
  const store1 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store1.init();
  await store1.batchSet([
    { key: ["test", "key1"], value: "value1" },
    { key: ["test", "key2"], value: "value2" },
  ]);

  // Delete one key
  await store1.batchDelete([["test", "key1"]]);

  // Create second instance
  const store2 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store2.init();

  // Check if delete was persisted
  const results = await store2.batchGet([["test", "key1"], ["test", "key2"]]);
  expect(results).toEqual([undefined, "value2"]);
});

test("MemoryKvPrimitives.fromFile creates and initializes store", async () => {
  const tempPath = tempFilePath();

  // Create JSON file with initial data
  const initialData = {
    "test\0key": "value",
  };
  await writeFile(tempPath, JSON.stringify(initialData), "utf-8");

  // Use factory method with throttling disabled
  const store = await MemoryKvPrimitives.fromFile(tempPath, {
    throttleMs: 0,
  });

  // Check if data was loaded
  const result = await store.batchGet([["test", "key"]]);
  expect(result).toEqual(["value"]);
});

test("MemoryKvPrimitives query works with persisted data", async () => {
  const tempPath = tempFilePath();

  // Create and populate store
  const store1 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store1.init();
  await store1.batchSet([
    { key: ["test", "key1"], value: "value1" },
    { key: ["test", "key2"], value: "value2" },
    { key: ["other", "key"], value: "value3" },
  ]);

  // Force persistence
  await store1.close();

  // Create second instance
  const store2 = await MemoryKvPrimitives.fromFile(tempPath, {
    throttleMs: 0,
  });

  // Test query with prefix
  const results: KV[] = [];
  for await (const item of store2.query({ prefix: ["test"] })) {
    results.push(item);
  }

  expect(results.length).toBe(2);
  expect(results[0].key).toEqual(["test", "key1"]);
  expect(results[0].value).toBe("value1");
  expect(results[1].key).toEqual(["test", "key2"]);
  expect(results[1].value).toBe("value2");
});
