// @vitest-environment happy-dom
import { h, render } from "preact";
import { expect, test } from "vitest";
import { resolveIconName } from "../../plug-api/ui/icons/registry.ts";
import { useFullIcons } from "../../plug-api/ui/icons/test_icons.ts";
import { iconComponent } from "./icon_component.tsx";

function renderIcon(name: string): HTMLElement {
  useFullIcons();
  const root = document.createElement("div");
  render(h(iconComponent(name), { size: 18 }), root);
  return root;
}

test("an action button icon accepts the feather: prefix", () => {
  expect(
    renderIcon("feather:lock").querySelector("svg.lucide-lock"),
  ).not.toBeNull();
});

test("a markup button icon resolves md-* names to Lucide", () => {
  const bold = resolveIconName("bold");
  expect(bold).toBeDefined();
  expect(
    renderIcon("md-format-bold").querySelector(`svg.lucide-${bold}`),
  ).not.toBeNull();
});

test("a slash command icon given inline SVG renders the fallback", () => {
  const root = renderIcon("<svg><circle r='4'/></svg>");
  expect(root.querySelector("svg.lucide-circle-question-mark")).not.toBeNull();
  expect(root.querySelector("circle[r='4']")).toBeNull();
});

test("the button size is passed through", () => {
  expect(renderIcon("lock").querySelector("svg")?.getAttribute("width")).toBe(
    "18",
  );
});
