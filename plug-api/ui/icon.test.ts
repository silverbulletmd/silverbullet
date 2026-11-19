// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Icon } from "./icon.tsx";
import { configureIcons, loadIcons } from "./icons/registry.ts";

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
  vi.unstubAllGlobals();
});

test("renders a named Lucide icon", () => {
  configureIcons({
    data: { icons: { book: [["path", { d: "M1 1" }]] }, aliases: {} },
  });
  render(h(Icon, { name: "book" }), root);
  expect(root.querySelector("svg.lucide-book")).not.toBeNull();
});

test("renders nothing without a name", () => {
  render(h(Icon, { name: null }), root);
  expect(root.querySelector("svg")).toBeNull();
});

test("fills in a lazily loaded icon", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            icons: { "zap-off": [["path", { d: "M1 1" }]] },
            aliases: {},
          }),
        ),
      ),
    ),
  );
  configureIcons({ url: "/icons.json" });
  await act(() => {
    render(h(Icon, { name: "zap-off" }), root);
  });
  expect(root.querySelector("svg.lucide-zap-off")).toBeNull();
  await act(async () => {
    await loadIcons();
  });
  expect(root.querySelector("svg.lucide-zap-off")).not.toBeNull();
});
