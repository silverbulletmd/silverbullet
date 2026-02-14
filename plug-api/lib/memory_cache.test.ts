import { expect, test } from "vitest";
import { ttlCache } from "./memory_cache.ts";
import { sleep } from "./async.ts";

test("Memory cache", async () => {
  let calls = 0;

  async function expensiveFunction(key: string) {
    calls++;
    await sleep(1);
    return key;
  }

  expect("key").toEqual(await ttlCache("key", expensiveFunction, 0.01));
  expect(1).toEqual(calls);
  expect("key").toEqual(await ttlCache("key", expensiveFunction, 0.01));
  expect(1).toEqual(calls);
  await sleep(10);
});
