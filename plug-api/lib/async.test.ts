import { assertEquals } from "../../test_deps.ts";
import { PromiseQueue, sleep } from "./async.ts";

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
