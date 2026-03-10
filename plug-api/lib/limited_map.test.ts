import { expect, test } from "vitest";
import { LimitedMap } from "./limited_map.ts";
import { sleep } from "./async.ts";

test("limited map", async () => {
  const mp = new LimitedMap<string>(3);
  mp.set("a", "a");
  mp.set("b", "b", 5);
  mp.set("c", "c");
  expect(mp.get("a")).toEqual("a");
  expect(mp.get("b")).toEqual("b");
  expect(mp.get("c")).toEqual("c");
  // Drops the first key
  mp.set("d", "d");
  // console.log(mp.toJSON());
  expect(mp.get("a")).toEqual(undefined);
  await sleep(10);
  // "b" should have been dropped
  expect(mp.get("b")).toEqual(undefined);
  expect(mp.get("c")).toEqual("c");

  console.log(mp.toJSON());
});
