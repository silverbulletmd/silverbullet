import { sleep } from "$sb/lib/async.ts";
import { ttlCache } from "$sb/lib/memory_cache.ts";
import { assertEquals } from "../../test_deps.ts";

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
