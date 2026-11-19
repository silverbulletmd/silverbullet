// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { HoverTracker } from "./hover.ts";
import { isRowMenuKey, openRowMenu, RowMenu } from "./row_menu.tsx";

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  render(null, root);
  root.remove();
});

const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const trigger = () =>
  root.querySelector<HTMLButtonElement>(".sb-row-menu-trigger")!;

function svgIcon(): Element {
  return document.createElementNS("http://www.w3.org/2000/svg", "svg");
}

/** A row the way the views draw one: clickable, with the menu at its end. */
async function mountRow(
  items: Parameters<typeof RowMenu>[0]["items"],
  onRowClick = () => {},
) {
  await act(() =>
    render(
      h(
        "div",
        { class: "row", onClick: onRowClick },
        h("span", null, "Garden"),
        h(RowMenu, { label: "Actions", items }),
      ),
      root,
    ),
  );
  return root.querySelector<HTMLElement>(".row")!;
}

test("the trigger takes a tab index", async () => {
  await act(() =>
    render(h(RowMenu, { label: "Actions", items: [], tabIndex: -1 }), root),
  );
  expect(trigger().tabIndex).toBe(-1);
});

test("the menu opens outside the row, with icons, and its clicks never reach the row", async () => {
  const rowClicks = vi.fn();
  const run = vi.fn();
  const row = await mountRow(
    [{ label: "Rename", icon: svgIcon(), run }],
    rowClicks,
  );
  await act(() => trigger().click());
  // Out of the row, so no overflow, mask or hover rule there can hide it.
  expect(menu()).not.toBeNull();
  expect(row.contains(menu())).toBe(false);
  expect(menu()!.querySelector(".sb-row-menu-icon svg")).not.toBeNull();
  const item = menu()!.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
  expect(item.textContent).toBe("Rename");
  await act(() => item.click());
  expect(run).toHaveBeenCalledTimes(1);
  expect(menu()).toBeNull();
  expect(rowClicks).not.toHaveBeenCalled();
});

test("openRowMenu opens the menu in a row, and reports whether it had one", async () => {
  const row = await mountRow([{ label: "Rename", run() {} }]);
  let opened = false;
  await act(() => {
    opened = openRowMenu(row);
  });
  expect(opened).toBe(true);
  expect(menu()).not.toBeNull();
  // Asking again (the menu key once more) leaves it open.
  await act(() => {
    openRowMenu(row);
  });
  expect(menu()).not.toBeNull();
  expect(openRowMenu(document.createElement("div"))).toBe(false);
});

test("Escape closes the menu and hands focus back to where it was", async () => {
  const row = await mountRow([{ label: "Rename", run() {} }]);
  const input = document.createElement("input");
  root.append(input);
  input.focus();
  await act(() => {
    openRowMenu(row);
  });
  const item = menu()!.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
  expect(document.activeElement).toBe(item);
  const onKey = vi.fn();
  document.addEventListener("keydown", onKey);
  await act(() => {
    item.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  document.removeEventListener("keydown", onKey);
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(input);
  expect(onKey).not.toHaveBeenCalled();
});

test("hover stays on the menu's row while the menu is open", async () => {
  const tracker = new HoverTracker();
  tracker.set("Garden");
  const row = await mountRow([{ label: "Rename", run() {} }]);
  await act(() => {
    openRowMenu(row);
  });
  // Crossing other rows (or leaving the list) on the way to the menu.
  tracker.set("Orchard");
  tracker.set(undefined);
  expect(tracker.get()).toBe("Garden");
  await act(() => {
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
  });
  expect(menu()).toBeNull();
  tracker.set("Orchard");
  expect(tracker.get()).toBe("Orchard");
});

test("the menu key and Shift-F10 open a row's menu", () => {
  expect(isRowMenuKey({ key: "ContextMenu", shiftKey: false })).toBe(true);
  expect(isRowMenuKey({ key: "F10", shiftKey: true })).toBe(true);
  expect(isRowMenuKey({ key: "F10", shiftKey: false })).toBe(false);
  expect(isRowMenuKey({ key: "Enter", shiftKey: true })).toBe(false);
});

test("the menu suppresses the browser's own context menu over it", async () => {
  const row = await mountRow([{ label: "Rename", run() {} }]);
  await act(() => {
    openRowMenu(row);
  });
  // Chrome on Windows/Linux fires the menu key's contextmenu on keyup, once
  // focus is already in the menu.
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  menu()!.querySelector('[role="menuitem"]')!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  // Rows themselves keep the browser's menu.
  const onRow = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
  });
  row.dispatchEvent(onRow);
  expect(onRow.defaultPrevented).toBe(false);
});

test("closing by scroll, resize or unmount hands focus back from the menu", async () => {
  const input = document.createElement("input");
  document.body.append(input);
  try {
    for (const close of ["scroll", "resize", "unmount"] as const) {
      const row = await mountRow([{ label: "Rename", run() {} }]);
      input.focus();
      await act(() => {
        openRowMenu(row);
      });
      expect(menu()!.contains(document.activeElement)).toBe(true);
      await act(() => {
        if (close === "scroll") document.dispatchEvent(new Event("scroll"));
        else if (close === "resize") window.dispatchEvent(new Event("resize"));
        else render(null, root);
      });
      expect(menu(), close).toBeNull();
      expect(document.activeElement, close).toBe(input);
    }
  } finally {
    input.remove();
  }
});
