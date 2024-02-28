import { sleep } from "$lib/async.ts";
import { assertEquals } from "$std/testing/asserts.ts";
import { LimitedMap } from "./limited_map.ts";

Deno.test("limited map", async () => {
  const mp = new LimitedMap<string>(3);
  mp.set("a", "a");
  mp.set("b", "b", 5);
  mp.set("c", "c");
  assertEquals(mp.get("a"), "a");
  assertEquals(mp.get("b"), "b");
  assertEquals(mp.get("c"), "c");
  // Drops the first key
  mp.set("d", "d");
  // console.log(mp.toJSON());
  assertEquals(mp.get("a"), undefined);
  await sleep(10);
  // "b" should have been dropped
  assertEquals(mp.get("b"), undefined);
  assertEquals(mp.get("c"), "c");

  console.log(mp.toJSON());
});
