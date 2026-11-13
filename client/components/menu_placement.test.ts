import { describe, expect, test } from "vitest";
import {
  MENU_MAX_WIDTH,
  placeMenu,
  placePopupMenu,
  placeSubmenu,
} from "./menu_placement.ts";

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

test("placePopupMenu: below and right-aligned, flipped above near the bottom, kept on screen", () => {
  const vp = { width: 400, height: 800 };
  const size = { width: 220, height: 200 };
  expect(
    placePopupMenu({ top: 100, bottom: 124, right: 380 }, size, vp),
  ).toEqual({ top: 128, left: 160 });
  expect(
    placePopupMenu({ top: 700, bottom: 724, right: 380 }, size, vp),
  ).toEqual({ top: 496, left: 160 });
  expect(
    placePopupMenu({ top: 100, bottom: 124, right: 100 }, size, vp),
  ).toEqual({ top: 128, left: 8 });
});

test("placePopupMenu: start-aligned extends rightwards from the button, kept on screen", () => {
  const vp = { width: 1000, height: 800 };
  const size = { width: 220, height: 200 };
  expect(
    placePopupMenu(
      { top: 100, bottom: 124, left: 300, right: 318 },
      size,
      vp,
      "start",
    ),
  ).toEqual({ top: 128, left: 300 });
  // No room to the right: shifted left to stay on screen
  expect(
    placePopupMenu(
      { top: 100, bottom: 124, left: 900, right: 918 },
      size,
      vp,
      "start",
    ),
  ).toEqual({ top: 128, left: 772 });
  // Still flips above near the bottom
  expect(
    placePopupMenu(
      { top: 700, bottom: 724, left: 300, right: 318 },
      size,
      vp,
      "start",
    ),
  ).toEqual({ top: 496, left: 300 });
});

test("placeSubmenu: right of the parent level with its row, else left of it, kept on screen", () => {
  const vp = { width: 1000, height: 800 };
  const size = { width: 200, height: 150 };
  const parent = { left: 100, right: 300 };
  // Room on the right: its first row lines up with the opening row
  expect(placeSubmenu({ top: 120 }, parent, size, vp)).toEqual({
    top: 115,
    left: 298,
  });
  // No room on the right: leftwards, overlapping the parent's edge by as much
  expect(
    placeSubmenu({ top: 120 }, { left: 700, right: 900 }, size, vp),
  ).toEqual({ top: 115, left: 502 });
  // Near the bottom: pulled up to stay on screen
  expect(placeSubmenu({ top: 760 }, parent, size, vp).top).toBe(642);
});
