import { describe, expect, test } from "vitest";
import { MENU_MAX_WIDTH, placeMenu } from "./menu_placement.ts";

const rect = (over: Partial<DOMRect>): DOMRect =>
  ({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: 0,
    height: 0,
    ...over,
  }) as DOMRect;

describe("placeMenu", () => {
  test("right-aligns to the trigger and sits below it", () => {
    const p = placeMenu(rect({ right: 900, bottom: 50 }), {
      width: 1000,
      height: 800,
    });
    expect(p.right).toBe(100);
    expect(p.top).toBe(54);
  });

  test("clamps width on a narrow viewport", () => {
    // Narrower than MENU_MAX_WIDTH + both gutters, so the viewport wins.
    expect(
      placeMenu(rect({ right: 230, bottom: 50 }), { width: 240, height: 700 })
        .maxWidth,
    ).toBe(240 - 16);
    expect(
      placeMenu(rect({ right: 900, bottom: 50 }), { width: 1000, height: 800 })
        .maxWidth,
    ).toBe(MENU_MAX_WIDTH);
  });

  test("never lets the menu run off the left edge when the trigger is far left", () => {
    const p = placeMenu(rect({ right: 40, bottom: 50 }), {
      width: 1000,
      height: 800,
    });
    expect(1000 - p.right - p.maxWidth).toBeGreaterThanOrEqual(8);
  });

  test("keeps a minimum gutter on the right", () => {
    const p = placeMenu(rect({ right: 1000, bottom: 50 }), {
      width: 1000,
      height: 800,
    });
    expect(p.right).toBeGreaterThanOrEqual(8);
  });
});
