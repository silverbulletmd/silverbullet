import { describe, expect, test } from "vitest";
import { bubblePosition, selectionCenterX } from "./selection_bubble.ts";

describe("bubblePosition", () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 100, height: 30 };

  test("above when there is room", () => {
    expect(
      bubblePosition({ left: 400, top: 200, bottom: 220 }, size, viewport),
    ).toEqual({ left: 350, top: 162, placement: "above" });
  });

  test("below near the top", () => {
    expect(
      bubblePosition({ left: 400, top: 20, bottom: 40 }, size, viewport),
    ).toEqual({ left: 350, top: 48, placement: "below" });
  });

  test("clamped at the right edge", () => {
    expect(
      bubblePosition({ left: 990, top: 200, bottom: 220 }, size, viewport),
    ).toEqual({ left: 892, top: 162, placement: "above" });
  });

  test("flips below when the space above is under the top bar", () => {
    // Room above in the viewport (162 >= 0), but the top bar ends at 180
    expect(
      bubblePosition(
        { left: 400, top: 200, bottom: 220, minTop: 180 },
        size,
        viewport,
      ),
    ).toEqual({ left: 350, top: 228, placement: "below" });
    // Clear of the top bar: stays above
    expect(
      bubblePosition(
        { left: 400, top: 300, bottom: 320, minTop: 180 },
        size,
        viewport,
      ).placement,
    ).toBe("above");
  });
});

describe("selectionCenterX", () => {
  test("the middle of the first row's selected span", () => {
    expect(selectionCenterX(400, 480)).toBe(440);
  });

  test("the left edge when the span is unknown or empty", () => {
    expect(selectionCenterX(400)).toBe(400);
    expect(selectionCenterX(400, 400)).toBe(400);
    expect(selectionCenterX(400, 380)).toBe(400);
  });
});
