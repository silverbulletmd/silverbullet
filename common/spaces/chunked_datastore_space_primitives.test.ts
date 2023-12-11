import { MemoryKvPrimitives } from "../../plugos/lib/memory_kv_primitives.ts";
import { assert, assertEquals } from "../../test_deps.ts";
import { ChunkedKvStoreSpacePrimitives } from "./chunked_datastore_space_primitives.ts";
import { testSpacePrimitives } from "./space_primitives.test.ts";

Deno.test("chunked_datastore_space_primitives", async () => {
  const memoryKv = new MemoryKvPrimitives();
  // In memory store and tiny chunks for testing
  const spacePrimitives = new ChunkedKvStoreSpacePrimitives(memoryKv, 5);
  await testSpacePrimitives(spacePrimitives);
  const [existingChunk, deletedChunk] = await memoryKv.batchGet([[
    "content",
    "test.txt",
    "000",
  ], ["content", "test.bin", "000"]]);
  assert(existingChunk.byteLength > 0);
  // This one was deleted during the test (but here we're checking the underlying store for content)
  assertEquals(deletedChunk, undefined);
});
