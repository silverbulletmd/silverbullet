// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { openPopupMenu, type PopupEntry } from "./popup_menu.ts";

const entries: PopupEntry[] = [
  { kind: "info", text: "Live · re-runs when the index changes" },
  { kind: "item", id: "a", label: "Alpha task", icon: "<svg></svg>" },
  { kind: "separator" },
  {
    kind: "item",
    id: "b",
    label: "Beta task",
    icon: document.createElement("i"),
    current: true,
  },
];

function anchor() {
  const b = document.createElement("button");
  document.body.append(b);
  return b;
}

afterEach(() => {
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  document.body.replaceChildren();
});

test("renders rows, marks the current item and picks by id", () => {
  const onPick = vi.fn();
  const a = anchor();
  openPopupMenu(a, entries, onPick, "sb-widget-menu");
  const menu = document.querySelector(".sb-dock-menu.sb-widget-menu")!;
  expect(menu.querySelector(".sb-widget-menu-info")?.textContent).toContain(
    "index",
  );
  expect(
    menu
      .querySelector('[data-action="b"]')
      ?.classList.contains("sb-dock-menu-current"),
  ).toBe(true);
  expect(a.getAttribute("aria-expanded")).toBe("true");
  menu.querySelector<HTMLElement>('[data-action="a"]')!.click();
  expect(onPick).toHaveBeenCalledWith("a");
  expect(document.querySelector(".sb-dock-menu")).toBeNull();
  expect(a.getAttribute("aria-expanded")).toBe("false");
});

test("one popup at a time; Escape closes and refocuses; scroll closes", () => {
  openPopupMenu(anchor(), entries, () => {});
  const second = anchor();
  openPopupMenu(second, entries, () => {});
  expect(document.querySelectorAll(".sb-dock-menu")).toHaveLength(1);
  const menu = document.querySelector<HTMLElement>(".sb-dock-menu")!;
  menu.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  menu.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  expect(document.querySelector(".sb-dock-menu")).toBeNull();
  expect(document.activeElement).toBe(second);
  openPopupMenu(second, entries, () => {});
  globalThis.dispatchEvent(new Event("scroll"));
  expect(document.querySelector(".sb-dock-menu")).toBeNull();
});
