import { describe, expect, test } from "vitest";
import { diffOverrides } from "./overrides.ts";

describe("diffOverrides", () => {
  test("sets new and changed values, unsets missing ones", () => {
    expect(
      diffOverrides<unknown>(
        { same: ["a"], changed: { k: 1 }, dropped: true },
        { same: ["a"], changed: { k: 2 }, added: "x" },
      ),
    ).toEqual({ set: { changed: { k: 2 }, added: "x" }, unset: ["dropped"] });
  });

  test("never writes undefined, nor unsets a key that is still there", () => {
    expect(
      diffOverrides({ a: undefined }, { a: undefined, b: undefined }),
    ).toEqual({ set: {}, unset: [] });
  });
});
