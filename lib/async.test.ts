import { assert, assertEquals } from "$std/testing/asserts.ts";
import { batchRequests, PromiseQueue, sleep } from "./async.ts";

Deno.test("PromiseQueue test", async () => {
  const q = new PromiseQueue();
  let r1RanFirst = false;
  const r1 = q.runInQueue(async () => {
    await sleep(10);
    r1RanFirst = true;
    // console.log("1");
    return 1;
  });
  const r2 = q.runInQueue(async () => {
    // console.log("2");
    await sleep(4);
    return 2;
  });
  assertEquals(await Promise.all([r1, r2]), [1, 2]);
  assertEquals(r1RanFirst, true);
  let wasRun = false;
  await q.runInQueue(async () => {
    await sleep(4);
    wasRun = true;
  });
  assertEquals(wasRun, true);
});

Deno.test("Batch test", async () => {
  // Generate an array with numbers up to 100
  const elements = Array.from(Array(100).keys());
  const multiplied = await batchRequests(elements, async (batch) => {
    await sleep(2);
    // Batches should be 9 or smaller (last batch will be smaller)
    assert(batch.length <= 9);
    return batch.map((e) => e * 2);
  }, 9);
  assertEquals(multiplied, elements.map((e) => e * 2));
  const multiplied2 = await batchRequests(elements, async (batch) => {
    return batch.map((e) => e * 2);
  }, 10000);
  assertEquals(multiplied2, elements.map((e) => e * 2));
});
