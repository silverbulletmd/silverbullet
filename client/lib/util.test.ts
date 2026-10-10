import { expect, test } from "vitest";
import { Disposers } from "./util.ts";

test("Disposers runs callbacks last-in-first-out and is reusable", () => {
  const calls: string[] = [];
  const d = new Disposers();
  d.add(() => calls.push("a"));
  d.add(() => calls.push("b"));
  d.dispose();
  expect(calls).toEqual(["b", "a"]);
  d.dispose();
  expect(calls).toEqual(["b", "a"]);
  d.add(() => calls.push("c"));
  d.dispose();
  expect(calls).toEqual(["b", "a", "c"]);
});
