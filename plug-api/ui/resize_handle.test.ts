import { expect, test } from "vitest";
import { resizedDockSize } from "./resize_handle.tsx";

test("dragging bhs upward makes the dock taller", () => {
  expect(resizedDockSize("bhs", 300, 500, 450, 1000)).toBe(350);
});

test("bhs height stops short of the window, leaving room for the editor", () => {
  expect(resizedDockSize("bhs", 300, 500, 900, 1000)).toBe(160);
  expect(resizedDockSize("bhs", 300, 500, -500, 1000)).toBe(800);
  expect(resizedDockSize("bhs", 300, 500, -500, 1400)).toBe(1200);
});

test("side widths keep their fixed bounds", () => {
  expect(resizedDockSize("rhs", 300, 500, -500, 1400)).toBe(600);
  expect(resizedDockSize("lhs", 300, 500, 0, 1400)).toBe(160);
});
