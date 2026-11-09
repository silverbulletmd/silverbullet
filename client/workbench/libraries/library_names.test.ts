import { describe, expect, test } from "vitest";
import { repositoryPage } from "./library_names.ts";

describe("repositoryPage", () => {
  test.each([
    ["Library/Repository/X", "Library/Repository/X"],
    ["X", "Library/Repository/X"],
    ["Other/X", "Library/Repository/Other/X"],
  ])("%s -> %s", (name, expected) => {
    expect(repositoryPage(name)).toBe(expected);
  });
});
