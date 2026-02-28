import { expect, test } from "vitest";
import { evalPromiseValues } from "./util.ts";

test("Test promise helpers", async () => {
  const r = evalPromiseValues([1, 2, 3]);
  // should return the same array not as a promise
  expect(r).toEqual([1, 2, 3]);
  const asyncR = evalPromiseValues([
    new Promise((resolve) => {
      setTimeout(() => {
        resolve(1);
      }, 5);
    }),
    Promise.resolve(2),
    3,
  ]);
  // should return a promise
  expect(asyncR instanceof Promise).toBeTruthy();
  expect(await asyncR).toEqual([1, 2, 3]);
});
