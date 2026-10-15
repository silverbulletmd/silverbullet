// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { IndexReport, SpaceSearchSummary } from "../types/search_admin.ts";
import { rebuildConfirmText } from "./search_admin_format.ts";
import { useConfirmedAction } from "./search_admin_state.ts";
import { SearchSpacesTable } from "./search_spaces_table.tsx";

const report = (state: object): IndexReport =>
  ({
    kind: "fullText",
    pages: 30,
    bytes: 2048,
    memory: false,
    buildSecs: 1,
    ...state,
  }) as IndexReport;

const space = (
  name: string,
  indexes: IndexReport[],
  running = true,
): SpaceSearchSummary & { running: boolean } => ({
  name,
  running,
  semanticChoice: null,
  semantic: "on",
  pages: 30,
  indexes,
});

const spaces = {
  a: space("Garden", [report({ state: "ready", catchUp: null })]),
  b: space("Orchard", [report({ state: "building", done: 3, total: 30 })]),
  c: space("Bikes", [report({ state: "waiting" })]),
  d: space("Allotment", [], false),
};

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

/** The table as the hosts wire it: Rebuild confirms, then runs. */
function Host({ run }: { run: (id: string) => Promise<void> }) {
  const rebuilds = useConfirmedAction({
    question: () => rebuildConfirmText(),
    run,
    onError: () => {},
  });
  return h(SearchSpacesTable<SpaceSearchSummary & { running: boolean }>, {
    spaces,
    rebuilding: rebuilds.running,
    onRebuild: (id) => void rebuilds.start(id),
    closed: (s) => !s.running,
  });
}

function trigger(name: string): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>(
    `button[aria-label="Actions for ${name}"]`,
  )!;
}

async function openMenu(name: string): Promise<HTMLButtonElement> {
  await act(() => {
    trigger(name).dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    trigger(name).click();
  });
  const item = root.querySelector<HTMLButtonElement>(
    '[role="menu"] [role="menuitem"]',
  );
  expect(item?.textContent).toBe("Rebuild");
  return item!;
}

test("Rebuild in a row's menu is disabled while that space builds or waits", async () => {
  await act(() => render(h(Host, { run: async () => {} }), root));
  expect((await openMenu("Orchard")).disabled).toBe(true);
  expect((await openMenu("Bikes")).disabled).toBe(true);
  expect((await openMenu("Garden")).disabled).toBe(false);
  // A closed space has no indexes to report, and can still be rebuilt.
  expect((await openMenu("Allotment")).disabled).toBe(false);
  // Only one menu is open at a time: the last one.
  expect(root.querySelectorAll('[role="menu"]').length).toBe(1);
});

test("Rebuild asks first, then rebuilds that space and closes the menu", async () => {
  const run = vi.fn(async () => {});
  const confirm = vi.fn(() => true);
  vi.stubGlobal("confirm", confirm);
  await act(() => render(h(Host, { run }), root));
  const item = await openMenu("Garden");
  await act(async () => item.click());
  expect(confirm).toHaveBeenCalledWith(
    "Are you sure you want to rebuild the search index?",
  );
  expect(run).toHaveBeenCalledWith("a");
  expect(root.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger("Garden"));
});

test("declining the confirmation rebuilds nothing", async () => {
  const run = vi.fn(async () => {});
  vi.stubGlobal(
    "confirm",
    vi.fn(() => false),
  );
  await act(() => render(h(Host, { run }), root));
  const item = await openMenu("Allotment");
  await act(async () => item.click());
  expect(run).not.toHaveBeenCalled();
});

test("the menu focuses its item and closes on Escape or a click outside", async () => {
  await act(() => render(h(Host, { run: async () => {} }), root));
  const item = await openMenu("Garden");
  expect(trigger("Garden").getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(item);
  await act(() => {
    item.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  expect(root.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger("Garden"));
  await openMenu("Garden");
  await act(() => {
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
  });
  expect(root.querySelector('[role="menu"]')).toBeNull();
});
