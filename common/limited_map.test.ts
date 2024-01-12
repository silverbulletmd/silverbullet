import { sleep } from "$sb/lib/async.ts";
import { assertEquals } from "../test_deps.ts";
import { LimitedMap } from "./limited_map.ts";

Deno.test("limited map", async () => {
  const mp = new LimitedMap<string>(3);
  mp.set("a", "a");
  mp.set("b", "b", 10);
  mp.set("c", "c");
  await sleep(2);
  assertEquals(mp.get("a"), "a");
  await sleep(2);
  assertEquals(mp.get("b"), "b");
  await sleep(2);
  assertEquals(mp.get("c"), "c");
  // Drops the first key
  mp.set("d", "d");
  assertEquals(mp.get("a"), undefined);
  await sleep(20);
  // "b" should have been dropped
  assertEquals(mp.get("b"), undefined);
  assertEquals(mp.get("c"), "c");

  console.log(mp.toJSON());
});
