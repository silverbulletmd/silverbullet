// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import {
  openPopupMenu,
  type PopupEntry,
  togglePopupMenu,
} from "./popup_menu.ts";

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
  openPopupMenu(a, entries, { onPick, className: "sb-widget-menu" });
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

test("togglePopupMenu closes the menu its anchor already has open", () => {
  const a = anchor();
  togglePopupMenu(a, entries);
  expect(document.querySelectorAll(".sb-dock-menu")).toHaveLength(1);
  togglePopupMenu(a, entries);
  expect(document.querySelector(".sb-dock-menu")).toBeNull();
  togglePopupMenu(a, entries);
  expect(document.querySelectorAll(".sb-dock-menu")).toHaveLength(1);
});

test("one popup at a time; Escape closes and refocuses; scroll closes", () => {
  openPopupMenu(anchor(), entries);
  const second = anchor();
  openPopupMenu(second, entries);
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
  openPopupMenu(second, entries);
  globalThis.dispatchEvent(new Event("scroll"));
  expect(document.querySelector(".sb-dock-menu")).toBeNull();
});

test("only a scroll that moves the anchor closes the menu", () => {
  const scroller = document.createElement("div");
  const a = document.createElement("button");
  scroller.append(a);
  const elsewhere = document.createElement("div");
  document.body.append(scroller, elsewhere);
  openPopupMenu(a, entries);
  elsewhere.dispatchEvent(new Event("scroll"));
  expect(document.querySelector(".sb-dock-menu")).not.toBeNull();
  scroller.dispatchEvent(new Event("scroll"));
  expect(document.querySelector(".sb-dock-menu")).toBeNull();
});

test("Enter and Space on an item stay in the menu, unprevented, so the item clicks", () => {
  openPopupMenu(anchor(), entries);
  const item = document.querySelector<HTMLElement>('[data-action="a"]')!;
  const reachedWindow = vi.fn();
  globalThis.addEventListener("keydown", reachedWindow);
  try {
    for (const key of ["Enter", " "]) {
      const e = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      item.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
    }
    expect(reachedWindow).not.toHaveBeenCalled();
  } finally {
    globalThis.removeEventListener("keydown", reachedWindow);
  }
});

test("a disabled item says why and can't be picked", () => {
  const onPick = vi.fn();
  openPopupMenu(
    anchor(),
    [
      {
        kind: "item",
        id: "x",
        label: "Remove",
        icon: "",
        disabled: "Something requires it",
      },
    ],
    { onPick },
  );
  const item = document.querySelector<HTMLElement>('[data-action="x"]')!;
  expect(item.getAttribute("aria-disabled")).toBe("true");
  expect(item.title).toBe("Something requires it");
  item.click();
  expect(onPick).not.toHaveBeenCalled();
  expect(document.querySelector(".sb-dock-menu")).not.toBeNull();
});

test("an item's hint is shown after its label", () => {
  openPopupMenu(
    anchor(),
    [
      { kind: "item", id: "a", label: "Indent", icon: "", hint: "Tab" },
      { kind: "item", id: "b", label: "Plain", icon: "" },
    ],
    { onPick: vi.fn() },
  );
  const hint = document.querySelector(
    '[data-action="a"].sb-dock-menu-item .sb-dock-menu-hint',
  );
  expect(hint?.textContent).toBe("Tab");
  expect(
    document.querySelector('[data-action="b"] .sb-dock-menu-hint'),
  ).toBeNull();
});

test("an item's own run is called instead of onPick; onClose reports every close, after Escape refocuses", () => {
  const onPick = vi.fn();
  const run = vi.fn();
  const order: string[] = [];
  const a = anchor();
  const items: PopupEntry[] = [
    {
      kind: "item",
      label: "Own",
      // Made as the row renders
      icon: () => document.createElement("b"),
      run: () => {
        run();
        order.push("run");
      },
    },
    { kind: "item", id: "b", label: "Picked", icon: "" },
  ];
  const onClose = vi.fn(() => order.push("close"));
  openPopupMenu(a, items, { onPick, onClose });
  expect(document.querySelector("[role=menuitem] > b")).not.toBeNull();
  document.querySelector<HTMLElement>("[role=menuitem]")!.click();
  expect(run).toHaveBeenCalledOnce();
  expect(onPick).not.toHaveBeenCalled();
  // Told of the close once the pick has run
  expect(order).toEqual(["run", "close"]);
  // Escape: the anchor has focus back by the time onClose hears of it
  let focusedOnClose: Element | null = null;
  openPopupMenu(a, items, {
    onPick,
    onClose: () => {
      focusedOnClose = document.activeElement;
    },
  });
  document
    .querySelector<HTMLElement>(".sb-dock-menu")!
    .dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  expect(focusedOnClose).toBe(a);
  // Another popup opening closes this one, once
  const closed = vi.fn();
  const close = openPopupMenu(a, items, { onClose: closed });
  openPopupMenu(anchor(), items);
  close();
  expect(closed).toHaveBeenCalledOnce();
});

const withSubmenu: PopupEntry[] = [
  { kind: "item", id: "plain", label: "Plain", icon: "" },
  {
    kind: "submenu",
    label: "Heading",
    icon: "",
    entries: [
      { kind: "item", id: "h1", label: "Heading 1", icon: "" },
      { kind: "item", id: "h2", label: "Heading 2", icon: "", current: true },
    ],
  },
];

const menus = () => [
  ...document.querySelectorAll<HTMLElement>(".sb-dock-menu"),
];
const key = (target: Element, k: string) =>
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }),
  );
const submenuRow = () =>
  document.querySelector<HTMLElement>('[aria-haspopup="menu"]')!;

test("a submenu row opens its menu on hover; picking in it picks and closes everything", () => {
  const onPick = vi.fn();
  openPopupMenu(anchor(), withSubmenu, {
    onPick,
    className: "sb-widget-menu",
  });
  const row = submenuRow();
  expect(row.textContent).toContain("Heading");
  expect(row.getAttribute("aria-expanded")).toBe("false");
  expect(menus()).toHaveLength(1);
  row.dispatchEvent(new MouseEvent("mouseenter"));
  expect(menus()).toHaveLength(2);
  expect(row.getAttribute("aria-expanded")).toBe("true");
  const child = menus()[1];
  expect(child.classList.contains("sb-widget-menu")).toBe(true);
  expect(
    child
      .querySelector('[data-action="h2"]')
      ?.classList.contains("sb-dock-menu-current"),
  ).toBe(true);
  // Hovering a plain row closes it again
  document
    .querySelector('[data-action="plain"]')!
    .dispatchEvent(new MouseEvent("mouseenter"));
  expect(menus()).toHaveLength(1);
  row.dispatchEvent(new MouseEvent("mouseenter"));
  menus()[1].querySelector<HTMLElement>('[data-action="h1"]')!.click();
  expect(onPick).toHaveBeenCalledWith("h1");
  expect(menus()).toHaveLength(0);
});

test("keys: → or Enter opens a submenu at its first row; ← or Escape closes it back to its row", () => {
  const a = anchor();
  openPopupMenu(a, withSubmenu);
  const row = submenuRow();
  row.focus();
  key(row, "ArrowRight");
  expect(menus()).toHaveLength(2);
  expect(document.activeElement?.getAttribute("data-action")).toBe("h1");
  key(document.activeElement!, "ArrowDown");
  expect(document.activeElement?.getAttribute("data-action")).toBe("h2");
  key(document.activeElement!, "ArrowLeft");
  expect(menus()).toHaveLength(1);
  expect(document.activeElement).toBe(row);
  // Enter and Space click the row (their default), which opens it
  const enter = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  });
  row.dispatchEvent(enter);
  expect(enter.defaultPrevented).toBe(false);
  row.click();
  expect(menus()).toHaveLength(2);
  expect(document.activeElement?.getAttribute("data-action")).toBe("h1");
  key(document.activeElement!, "Escape");
  expect(menus()).toHaveLength(1);
  expect(document.activeElement).toBe(row);
  // Escape in the top menu closes it, back to the anchor
  key(row, "Escape");
  expect(menus()).toHaveLength(0);
  expect(document.activeElement).toBe(a);
});

test("an outside click closes the menu and its open submenu", () => {
  openPopupMenu(anchor(), withSubmenu);
  submenuRow().dispatchEvent(new MouseEvent("mouseenter"));
  expect(menus()).toHaveLength(2);
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  expect(menus()).toHaveLength(0);
});

test("arrow keys, Home and End stay in the menu at every level, acted on or not", () => {
  const a = anchor();
  openPopupMenu(a, withSubmenu);
  const reachedWindow = vi.fn();
  globalThis.addEventListener("keydown", reachedWindow);
  try {
    const plain = document.querySelector<HTMLElement>('[data-action="plain"]')!;
    plain.focus();
    // ← in the top menu and → on a plain row do nothing, but stay
    for (const k of ["ArrowLeft", "ArrowRight", "Home", "End"]) key(plain, k);
    expect(menus()).toHaveLength(1);
    // End went to the last row: the submenu's
    expect(document.activeElement).toBe(submenuRow());
    key(document.activeElement!, "ArrowRight");
    expect(menus()).toHaveLength(2);
    // → on a leaf row of a submenu
    key(document.activeElement!, "ArrowRight");
    key(document.activeElement!, "End");
    expect(document.activeElement?.getAttribute("data-action")).toBe("h2");
    key(document.activeElement!, "Home");
    expect(document.activeElement?.getAttribute("data-action")).toBe("h1");
    expect(reachedWindow).not.toHaveBeenCalled();
    expect(menus()).toHaveLength(2);
  } finally {
    globalThis.removeEventListener("keydown", reachedWindow);
  }
});

test("pointing at another row while a submenu has focus refocuses its row, not the page", () => {
  openPopupMenu(anchor(), withSubmenu);
  const row = submenuRow();
  row.focus();
  key(row, "ArrowRight");
  expect(document.activeElement?.getAttribute("data-action")).toBe("h1");
  document
    .querySelector('[data-action="plain"]')!
    .dispatchEvent(new MouseEvent("mouseenter"));
  expect(menus()).toHaveLength(1);
  expect(document.activeElement).toBe(row);
});
