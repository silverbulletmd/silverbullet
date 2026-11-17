import { expect, test } from "vitest";
import { openClientKv } from "./client_kv.ts";
import { InMemoryKvPrimitives } from "./in_memory_kv_primitives.ts";

test("an ephemeral session keeps its datastore in memory", async () => {
  // No IndexedDB in this environment: touching it would throw.
  const kv = await openClientKv({ ephemeralStorage: true }, "sb_data_test");
  expect(kv).toBeInstanceOf(InMemoryKvPrimitives);
  await kv.batchSet([{ key: ["a"], value: 1 }]);
  expect(await kv.batchGet([["a"]])).toEqual([1]);
});
