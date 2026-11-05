import { expect, test } from "vitest";
import { draggedSize } from "./resize_handle.tsx";

test("dragging toward the panel's growing side makes it larger", () => {
  expect(draggedSize(300, 500, 560)).toBe(360);
  expect(draggedSize(300, 500, 450, -1)).toBe(350);
});

test("dragging the other way makes it smaller", () => {
  expect(draggedSize(300, 500, 450)).toBe(250);
  expect(draggedSize(300, 500, 560, -1)).toBe(240);
});
