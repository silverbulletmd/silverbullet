import { expect, test } from "vitest";
import { cachesToDelete } from "./cache_generations.ts";

test("an activating worker keeps its own and the newest previous generation", () => {
  expect(
    cachesToDelete(
      [
        "cache-100",
        "cache-300",
        "cache-200",
        "silverbullet.http://localhost/.tooling",
        "something-else",
      ],
      "cache-300",
    ).sort(),
  ).toEqual(["cache-100", "something-else"]);
});

test("a first install has nothing to delete", () => {
  expect(cachesToDelete(["cache-1"], "cache-1")).toEqual([]);
});
