import { assertEquals } from "@std/assert";
import { MemoryKvPrimitives } from "./memory_kv_primitives.ts";
import { allTests } from "./kv_primitives.test.ts";

import type { KV } from "../../type/datastore.ts";

Deno.test("MemoryKvPrimitives loads from non-existent file without error", async () => {
  const tempPath = await Deno.makeTempFile() + "_nonexistent";
  // Disable throttling for tests
  const store = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store.init();

  // Should create an empty store
  const result = await store.batchGet([["test"]]);
  assertEquals(result, [undefined]);
});

Deno.test("MemoryKvPrimitives passes all KvPrimitives tests", async () => {
  const tempPath = await Deno.makeTempFile();

  try {
    const store = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
    await store.init();
    await allTests(store);
    await store.close();
  } finally {
    // Clean up
    try {
      await Deno.remove(tempPath);
    } catch (_) {
      // Ignore errors during cleanup
    }
  }
});

Deno.test("MemoryKvPrimitives persists and loads data", async () => {
  const tempPath = await Deno.makeTempFile();

  try {
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
    assertEquals(results, ["value1", "value2"]);
  } finally {
    // Clean up
    try {
      await Deno.remove(tempPath);
    } catch (_) {
      // Ignore errors during cleanup
    }
  }
});

Deno.test("MemoryKvPrimitives mutations trigger persistence", async () => {
  const tempPath = await Deno.makeTempFile();

  try {
    // Create and populate first instance
    const store1 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
    await store1.init();
    await store1.batchSet([{ key: ["test", "key"], value: "value" }]);

    // No need to wait for throttled persistence since we disabled it

    // Create second instance without closing the first one
    const store2 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
    await store2.init();

    // Check if data was persisted
    const results = await store2.batchGet([["test", "key"]]);
    assertEquals(results, ["value"]);
  } finally {
    // Clean up
    try {
      await Deno.remove(tempPath);
    } catch (_) {
      // Ignore errors during cleanup
    }
  }
});

Deno.test("MemoryKvPrimitives persists delete operations", async () => {
  const tempPath = await Deno.makeTempFile();

  try {
    // Create and populate store
    const store1 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
    await store1.init();
    await store1.batchSet([
      { key: ["test", "key1"], value: "value1" },
      { key: ["test", "key2"], value: "value2" },
    ]);

    // Delete one key
    await store1.batchDelete([["test", "key1"]]);

    // No need to wait for throttled persistence since we disabled it

    // Create second instance
    const store2 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
    await store2.init();

    // Check if delete was persisted
    const results = await store2.batchGet([["test", "key1"], ["test", "key2"]]);
    assertEquals(results, [undefined, "value2"]);
  } finally {
    // Clean up
    try {
      await Deno.remove(tempPath);
    } catch (_) {
      // Ignore errors during cleanup
    }
  }
});

Deno.test("MemoryKvPrimitives.fromFile creates and initializes store", async () => {
  const tempPath = await Deno.makeTempFile();

  try {
    // Create JSON file with initial data
    const initialData = {
      "test\0key": "value",
    };
    await Deno.writeTextFile(tempPath, JSON.stringify(initialData));

    // Use factory method with throttling disabled
    const store = await MemoryKvPrimitives.fromFile(tempPath, {
      throttleMs: 0,
    });

    // Check if data was loaded
    const result = await store.batchGet([["test", "key"]]);
    assertEquals(result, ["value"]);
  } finally {
    // Clean up
    try {
      await Deno.remove(tempPath);
    } catch (_) {
      // Ignore errors during cleanup
    }
  }
});

Deno.test("MemoryKvPrimitives query works with persisted data", async () => {
  const tempPath = await Deno.makeTempFile();

  try {
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

    assertEquals(results.length, 2);
    assertEquals(results[0].key, ["test", "key1"]);
    assertEquals(results[0].value, "value1");
    assertEquals(results[1].key, ["test", "key2"]);
    assertEquals(results[1].value, "value2");
  } finally {
    // Clean up
    try {
      await Deno.remove(tempPath);
    } catch (_) {
      // Ignore errors during cleanup
    }
  }
});
