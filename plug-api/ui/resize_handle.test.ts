import { expect, test } from "vitest";
import { resizedDockSize } from "./resize_handle.tsx";

test("dragging bhs upward makes the dock taller", () => {
  expect(resizedDockSize("bhs", 300, 500, 450)).toBe(350);
});

test("bhs height is clamped to the dock bounds", () => {
  expect(resizedDockSize("bhs", 300, 500, 900)).toBe(160);
  expect(resizedDockSize("bhs", 300, 500, -500)).toBe(600);
});
