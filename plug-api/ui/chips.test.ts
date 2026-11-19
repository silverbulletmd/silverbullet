// @vitest-environment happy-dom
import { h, render } from "preact";
import { expect, test } from "vitest";
import { Chip } from "./chips.tsx";
import { useFullIcons } from "./icons/test_icons.ts";

function chip(decoration: { icon?: string; text?: string }): HTMLElement {
  useFullIcons();
  const root = document.createElement("div");
  render(h(Chip, { decoration }), root);
  return root;
}

test("a chip with an icon and text renders both", () => {
  const root = chip({ icon: "clock", text: "3" });
  expect(root.querySelector("svg.lucide-clock")).not.toBeNull();
  expect(root.textContent).toBe("3");
});

test("a chip icon is an icon, not its name as text", () => {
  const root = chip({ icon: "clock" });
  expect(root.querySelector("svg.lucide-clock")).not.toBeNull();
  expect(root.textContent).not.toContain("clock");
});

test("a text-only chip renders its text", () => {
  expect(chip({ text: "draft" }).textContent).toBe("draft");
});
