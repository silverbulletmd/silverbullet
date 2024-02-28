import { KvPrimitives } from "./kv_primitives.ts";
import { assertEquals } from "$std/testing/asserts.ts";
import { KV } from "../../plug-api/types.ts";

export async function allTests(db: KvPrimitives) {
  await db.batchSet([
    { key: ["kv", "test2"], value: "Hello2" },
    { key: ["kv", "test1"], value: "Hello1" },
    { key: ["other", "random"], value: "Hello3" },
  ]);
  const result = await db.batchGet([["kv", "test1"], ["kv", "test2"], [
    "kv",
    "test3",
  ]]);
  assertEquals(result.length, 3);
  assertEquals(result[0], "Hello1");
  assertEquals(result[1], "Hello2");
  assertEquals(result[2], undefined);
  let counter = 0;
  // Query all
  for await (const _entry of db.query({})) {
    counter++;
  }
  assertEquals(counter, 3);

  counter = 0;
  // Query prefix
  for await (const _entry of db.query({ prefix: ["kv"] })) {
    counter++;
    console.log(_entry);
  }
  assertEquals(counter, 2);

  // Delete a few keys
  await db.batchDelete([["kv", "test1"], ["other", "random"]]);
  const result2 = await db.batchGet([["kv", "test1"], ["kv", "test2"], [
    "other",
    "random",
  ]]);
  assertEquals(result2.length, 3);
  assertEquals(result2[0], undefined);
  assertEquals(result2[1], "Hello2");
  assertEquals(result2[2], undefined);

  // Update a key
  await db.batchSet([{ key: ["kv", "test2"], value: "Hello2.1" }]);
  const [val] = await db.batchGet([["kv", "test2"]]);
  assertEquals(val, "Hello2.1");

  // Set a large batch
  const largeBatch: KV[] = [];
  for (let i = 0; i < 50; i++) {
    largeBatch.push({ key: ["test", "test" + i], value: "Hello" });
  }
  await db.batchSet(largeBatch);
  const largeBatchResult: KV[] = [];
  for await (const entry of db.query({ prefix: ["test"] })) {
    largeBatchResult.push(entry);
  }
  assertEquals(largeBatchResult.length, 50);

  // Delete the large batch
  await db.batchDelete(largeBatch.map((e) => e.key));

  // Make sure they're gone
  for await (const _entry of db.query({ prefix: ["test"] })) {
    throw new Error("This should not happen");
  }
}
