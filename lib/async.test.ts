import { assert, assertEquals } from "@std/assert";
import {
  batchRequests,
  processWithConcurrency,
  PromiseQueue,
  sleep,
} from "./async.ts";

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

Deno.test("processWithConcurrency test - basic functionality", async () => {
  const items = [1, 2, 3, 4, 5];
  const results = await processWithConcurrency(
    items,
    async (item) => {
      await sleep(10);
      return item * 2;
    },
    2,
  );
  assertEquals(results, [2, 4, 6, 8, 10]);
});

Deno.test("processWithConcurrency test - maintains order", async () => {
  const items = [1, 2, 3, 4, 5];
  const startTimes: number[] = [];
  const endTimes: number[] = [];

  const results = await processWithConcurrency(
    items,
    async (item) => {
      const start = Date.now();
      startTimes[item - 1] = start;
      // Longer sleep for higher numbers to test order preservation
      await sleep(item * 5);
      endTimes[item - 1] = Date.now();
      return `item-${item}`;
    },
    2,
  );

  // Results should be in original order despite different processing times
  assertEquals(results, ["item-1", "item-2", "item-3", "item-4", "item-5"]);
});

Deno.test("processWithConcurrency test - concurrency limit", async () => {
  const items = [1, 2, 3, 4, 5, 6];
  const activeCount = { value: 0 };
  const maxActive = { value: 0 };

  const results = await processWithConcurrency(
    items,
    async (item) => {
      activeCount.value++;
      maxActive.value = Math.max(maxActive.value, activeCount.value);
      await sleep(20);
      activeCount.value--;
      return item;
    },
    3,
  );

  assertEquals(results, [1, 2, 3, 4, 5, 6]);
  // Should never exceed concurrency limit of 3
  assertEquals(maxActive.value <= 3, true);
});

Deno.test("processWithConcurrency test - empty array", async () => {
  const results = await processWithConcurrency(
    [],
    async (item) => item,
    2,
  );
  assertEquals(results, []);
});

Deno.test("processWithConcurrency test - concurrency higher than item count", async () => {
  const items = [1, 2, 3];
  const results = await processWithConcurrency(
    items,
    async (item) => {
      await sleep(10);
      return item + 10;
    },
    10, // Higher than items.length
  );
  assertEquals(results, [11, 12, 13]);
});

Deno.test("processWithConcurrency test - error handling", async () => {
  const items = [1, 2, 3, 4, 5];

  try {
    await processWithConcurrency(
      items,
      async (item) => {
        if (item === 3) {
          throw new Error(`Error processing item ${item}`);
        }
        return item * 2;
      },
      2,
    );
    assert(false, "Should have thrown an error");
  } catch (error) {
    assert(
      error instanceof Error &&
        error.message.includes("Error processing item 3"),
    );
  }
});

Deno.test("processWithConcurrency test - performance with concurrency", async () => {
  const items = Array.from({ length: 6 }, (_, i) => i + 1);
  const delay = 30;

  // Test with concurrency of 1 (sequential)
  const start1 = Date.now();
  await processWithConcurrency(
    items,
    async (item) => {
      await sleep(delay);
      return item;
    },
    1,
  );
  const sequential = Date.now() - start1;

  // Test with concurrency of 3 (parallel)
  const start2 = Date.now();
  await processWithConcurrency(
    items,
    async (item) => {
      await sleep(delay);
      return item;
    },
    3,
  );
  const parallel = Date.now() - start2;

  // Parallel should be significantly faster than sequential
  // Allow some margin for timing variations
  assert(
    parallel < sequential * 0.8,
    `Parallel (${parallel}ms) should be faster than sequential (${sequential}ms)`,
  );
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
  const multiplied2 = await batchRequests(elements, (batch) => {
    return Promise.resolve(batch.map((e) => e * 2));
  }, 10000);
  assertEquals(multiplied2, elements.map((e) => e * 2));
});
