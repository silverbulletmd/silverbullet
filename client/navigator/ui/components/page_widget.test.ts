// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import type { Client } from "../../../client.ts";
import type { PageSlotView } from "../../page_slots.ts";
import { renderPageSlot, unmountPageSlot } from "./page_widget.tsx";

const view = vi.hoisted(() => ({
  name: "sketch.top",
  meta: {
    hasContent: true,
    frame: "minimal",
    refreshOn: ["custom:refresh"],
  },
  collapsed: false,
})) as PageSlotView;

const calls: { view: string; hook: string; args: any }[] = [];

vi.mock(import("../../registry.ts"), async (importOriginal) => ({
  ...(await importOriginal()),
  handle: async ({ view, hook, args }: any) => {
    calls.push({ view, hook, args });
    const runs = calls.filter((call) => call.hook === hook).length;
    if (hook === "content") return { value: `Runs: ${runs}` };
    return undefined;
  },
}));
vi.mock(import("../../page_slots.ts"), async (importOriginal) => ({
  ...(await importOriginal()),
  pageSlotViews: async () => [view],
}));
vi.mock("../../../sandbox/widget_sandbox_iframe.ts", () => ({
  createWidgetSandboxIFrame: vi.fn(),
}));
vi.mock("./row_markdown.tsx", () => ({
  MarkdownText: () => null,
  renderRows: async (_client: any, rows: any[]) => rows.map((row) => ({ row })),
}));
vi.mock("./content_view.tsx", () => ({
  ContentNode: () => null,
  useRenderedValue: (_c: unknown, value: unknown) => ({
    content: value === undefined ? undefined : { markdown: String(value) },
    current: value !== undefined,
  }),
}));

const { NavPageSlotWidget } = await import(
  "../../../codemirror/widgets/top_bottom_panels.ts"
);

const listeners = new Map<string, Set<() => void>>();

function fakeClient(path: string): Client {
  return {
    currentName: () => path.replace(/\.md$/, ""),
    currentPath: () => path,
    widgetCache: {
      getCachedWidgetHeight: () => 0,
      setCachedWidgetMeta: () => {},
    },
    eventHook: {
      addLocalListener: (name: string, fn: () => void) => {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(fn);
      },
      removeLocalListener: (name: string, fn: () => void) =>
        listeners.get(name)?.delete(fn),
    },
    isReadOnlyMode: () => false,
  } as unknown as Client;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function mountSlot(
  client: Client,
  slotView = view,
): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  renderPageSlot(host, [slotView], "page-top", client, () => {});
  await settle();
  return host;
}

function runs(hook: string) {
  return calls.filter((call) => call.hook === hook).length;
}
const contentRuns = () => runs("content");

beforeEach(() => {
  calls.length = 0;
  listeners.clear();
});

test("a page-docked content view runs once per page load", async () => {
  const client = fakeClient("Projects/Sketchbook.md");
  const key = "pageslot:top:Projects/Sketchbook.md";
  // Boot decorates the page while widgets load, then the ready rebuild replaces the slot
  const loading = new NavPageSlotWidget(client, "page-top", key, false);
  const first = loading.toDOM();
  document.body.append(first);
  await settle();
  loading.destroy(first);
  first.remove();
  const ready = new NavPageSlotWidget(client, "page-top", key, true);
  document.body.append(ready.toDOM());
  await settle();
  expect(contentRuns()).toBe(1);
});

test("another page, or a refresh event, runs the content again", async () => {
  const sketchbook = fakeClient("Projects/Sketchbook.md");
  const first = await mountSlot(sketchbook);
  unmountPageSlot(first);
  const other = await mountSlot(fakeClient("Projects/Alpha task.md"));
  expect(contentRuns()).toBe(2);
  for (const fn of listeners.get("custom:refresh") ?? []) fn();
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(contentRuns()).toBe(3);
  expect(other.textContent).not.toContain("Error");
});
