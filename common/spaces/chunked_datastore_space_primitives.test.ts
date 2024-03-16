import { MemoryKvPrimitives } from "$lib/data/memory_kv_primitives.ts";
import { assertEquals } from "$std/testing/asserts.ts";
import { ChunkedKvStoreSpacePrimitives } from "./chunked_datastore_space_primitives.ts";
import { testSpacePrimitives } from "./space_primitives.test.ts";

Deno.test("chunked_datastore_space_primitives", async () => {
  const memoryKv = new MemoryKvPrimitives();
  // In memory store and tiny chunks for testing
  const spacePrimitives = new ChunkedKvStoreSpacePrimitives(memoryKv, 5);
  await testSpacePrimitives(spacePrimitives);
  const [deletedChunk] = await memoryKv.batchGet([[
    "content",
    "test.bin",
    "000",
  ]]);
  // This one was deleted during the test (but here we're checking the underlying store for content)
  assertEquals(deletedChunk, undefined);
});
