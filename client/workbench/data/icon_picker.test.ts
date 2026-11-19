// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, test, vi } from "vitest";
import { IconPicker } from "./icon_picker.tsx";

afterEach(() => vi.restoreAllMocks());

function rect(top: number, height: number, left = 20, width = 30): DOMRect {
  return {
    top,
    bottom: top + height,
    left,
    right: left + width,
    width,
    height,
    x: left,
    y: top,
    toJSON() {},
  } as DOMRect;
}

async function openNear(buttonTop: number) {
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(600);
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("sb-wbd-icongrid")
        ? rect(0, 300, 0, 360)
        : rect(buttonTop, 24);
    },
  );
  const root = document.createElement("div");
  document.body.append(root);
  render(
    h(IconPicker, { icon: "tag", disabled: false, onPick: () => {} }),
    root,
  );
  await act(async () => {
    (root.querySelector(".sb-wbd-iconbutton") as HTMLElement).click();
  });
  return root.querySelector(".sb-wbd-icongrid") as HTMLElement;
}

test("the icon popover opens below its button when there is room", async () => {
  const popover = await openNear(100);
  expect(popover.style.top).toBe(`${100 + 24 + 4}px`);
});

test("the icon popover opens above its button near the bottom of the window", async () => {
  const popover = await openNear(560);
  expect(popover.style.top).toBe(`${560 - 4 - 300}px`);
});
