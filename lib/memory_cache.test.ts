import { ttlCache } from "$lib/memory_cache.ts";
import { sleep } from "$lib/async.ts";
import { assertEquals } from "$std/testing/asserts.ts";

Deno.test("Memory cache", async () => {
  let calls = 0;
  async function expensiveFunction(key: string) {
    calls++;
    await sleep(1);
    return key;
  }
  assertEquals("key", await ttlCache("key", expensiveFunction, 0.01));
  assertEquals(1, calls);
  assertEquals("key", await ttlCache("key", expensiveFunction, 0.01));
  assertEquals(1, calls);
  await sleep(10);
});
