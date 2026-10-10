import { expect, test, vi } from "vitest";

const unmountPageSlot = vi.fn();
const renderPageSlot = vi.fn();
vi.mock("../../sandbox/widget_sandbox_iframe.ts", () => ({
  createWidgetSandboxIFrame: vi.fn(),
}));
vi.mock("../../navigator/page_slots.ts", () => ({
  pageSlotViews: () => Promise.resolve([]),
}));
vi.mock("../../navigator/ui/components/page_widget.tsx", () => ({
  renderPageSlot: (...args: unknown[]) => renderPageSlot(...args),
  unmountPageSlot: (...args: unknown[]) => unmountPageSlot(...args),
}));

const { NavPageSlotWidget } = await import("./top_bottom_panels.ts");
const { activeWidgets } = await import("./code_widget.ts");

const client = {
  widgetCache: { getCachedWidgetHeight: () => 0 },
} as any;

// CodeMirror keeps the DOM of an `eq` widget but hands its newest instance to
// `destroy`, so teardown has to find the instance that actually mounted.
test("destroying through a reused instance unmounts the slot that rendered", async () => {
  vi.stubGlobal("document", {
    createElement: () => ({ className: "", style: {}, dataset: {} }),
  });
  const mounted = new NavPageSlotWidget(client, "page-top", "slot:a", true);
  const reused = new NavPageSlotWidget(client, "page-top", "slot:a", true);
  const dom = mounted.toDOM();
  await Promise.resolve();

  reused.destroy(dom);

  expect(unmountPageSlot).toHaveBeenCalledWith(dom);
  expect(activeWidgets.has(mounted)).toBe(false);
});

test("a page slot runs no view until widgets are ready", async () => {
  renderPageSlot.mockClear();
  const loading = new NavPageSlotWidget(client, "page-top", "slot:b", false);
  loading.toDOM();
  await new Promise((r) => setTimeout(r, 0));
  expect(renderPageSlot).not.toHaveBeenCalled();
  const ready = new NavPageSlotWidget(client, "page-top", "slot:b", true);
  expect(ready.eq(loading)).toBe(false);
  ready.toDOM();
  await new Promise((r) => setTimeout(r, 0));
  expect(renderPageSlot).toHaveBeenCalledTimes(1);
});
