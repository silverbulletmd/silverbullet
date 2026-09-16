import { expect, it } from "vitest";
import { descriptionText, normalizeDescription } from "./description.ts";

it("preserves plain descriptions and rejects malformed structures", () => {
  expect(normalizeDescription("**plain**")).toBe("**plain**");
  expect(normalizeDescription({ text: 42 })).toBeUndefined();
  expect(normalizeDescription({ text: "hello", highlights: {} })).toEqual({
    text: "hello",
    highlights: [],
  });
});

it("sorts and merges valid ranges without splitting Unicode characters", () => {
  expect(
    normalizeDescription({
      text: "🌲 walking home",
      label: "Route",
      highlights: [
        [5, 10],
        [3, 7],
        [0, 1],
        [-1, 4],
        [10, 99],
        [4, 4],
        [3.5, 5],
      ],
    }),
  ).toEqual({ text: "🌲 walking home", label: "Route", highlights: [[3, 10]] });
});

it("includes the label and text when filtering a structured description", () => {
  expect(descriptionText({ label: "Route", text: "Walking home" })).toBe(
    "Route Walking home",
  );
  expect(descriptionText("plain")).toBe("plain");
  expect(descriptionText(undefined)).toBe("");
});
