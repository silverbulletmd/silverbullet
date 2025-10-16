import { assert, assertEquals } from "@std/assert";
import { EncryptedKvPrimitives } from "./encrypted_kv_primitives.ts";
import { MemoryKvPrimitives } from "./memory_kv_primitives.ts";

Deno.test("Test Encrypted KV Primitives", async () => {
  const memoryKv = new MemoryKvPrimitives();
  const salt = new Uint8Array(32);
  const kv = new EncryptedKvPrimitives(memoryKv, "test", salt);
  await kv.init();

  // Store a basic key
  await kv.batchSet([{ key: ["key"], value: 10 }]);
  const [value] = await kv.batchGet([["key"]]);
  assertEquals(value, 10);

  // Store a binary blob
  const blob = new Uint8Array([1, 2, 3, 4, 5]);
  await kv.batchSet([{ key: ["blob"], value: blob }]);
  const [blobValue] = await kv.batchGet([["blob"]]);
  assertEquals(blobValue, blob);

  // Store a nested JSON and blob structure
  const nested = {
    json: { a: 1, b: 2 },
    blob: new Uint8Array([6, 7, 8, 9, 10]),
  };
  await kv.batchSet([{ key: ["nested"], value: nested }]);
  const [nestedValue] = await kv.batchGet([["nested"]]);
  assertEquals(nestedValue, nested);

  // Put a few objects with a person prefix
  await kv.batchSet([
    { key: ["person", "alice"], value: { name: "Alice", age: 30 } },
    { key: ["person", "bob"], value: { name: "Bob", age: 25 } },
  ]);

  // Then query based on the prefix
  let counter = 0;
  for await (const { key, value } of kv.query({ prefix: ["person"] })) {
    assertEquals(key[0], "person");
    assert(key[1] === "alice" || key[1] === "bob");
    assert(value.age);
    counter++;
  }
  assertEquals(counter, 2);

  // Delete something
  await kv.batchDelete([["person", "alice"]]);
  // Check it's gone
  const [deletedValue] = await kv.batchGet([["person", "alice"]]);
  assertEquals(deletedValue, undefined);

  console.log(memoryKv);

  // Clear
  await kv.clear();
  counter = 0;
  for await (const _ of kv.query({ prefix: ["person"] })) {
    counter++;
  }
  assertEquals(counter, 0);
});
