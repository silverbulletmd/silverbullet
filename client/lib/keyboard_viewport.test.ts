import { expect, test } from "vitest";
import { measureViewport } from "./keyboard_viewport.ts";

test("iOS 27: only the visual viewport shrinks", () => {
  expect(
    measureViewport({
      innerHeight: 714,
      layoutHeight: 714,
      visualViewport: { height: 384, offsetTop: 0, scale: 1 },
    }),
  ).toEqual({ top: 0, height: 384, inset: 330 });
});

test("iOS 26: innerHeight shrinks too, so the inset comes from clientHeight", () => {
  expect(
    measureViewport({
      innerHeight: 544,
      layoutHeight: 714,
      visualViewport: { height: 377, offsetTop: 0, scale: 1 },
    }),
  ).toEqual({ top: 0, height: 377, inset: 337 });
});

test("a scrolled visual viewport keeps its offset", () => {
  expect(
    measureViewport({
      innerHeight: 1086,
      layoutHeight: 1124,
      visualViewport: { height: 784, offsetTop: 38, scale: 1 },
    }),
  ).toEqual({ top: 38, height: 784, inset: 302 });
});

test("pinch zoom is not mistaken for a keyboard", () => {
  expect(
    measureViewport({
      innerHeight: 714,
      layoutHeight: 714,
      visualViewport: { height: 357, offsetTop: 120, scale: 2 },
    }),
  ).toEqual({ top: 0, height: 714, inset: 0 });
});

test("the VirtualKeyboard API wins over the visual viewport", () => {
  expect(
    measureViewport({
      innerHeight: 789,
      layoutHeight: 789,
      visualViewport: { height: 789, offsetTop: 0, scale: 1 },
      virtualKeyboardHeight: 311,
    }),
  ).toEqual({ top: 0, height: 478, inset: 311 });
});

test("a collapsed Android keyboard reports no inset while focus stays", () => {
  expect(
    measureViewport({
      innerHeight: 789,
      layoutHeight: 789,
      virtualKeyboardHeight: 0,
    }),
  ).toEqual({ top: 0, height: 789, inset: 0 });
});
