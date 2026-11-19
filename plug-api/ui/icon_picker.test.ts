// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { IconPicker } from "./icon_picker.tsx";
import { configureIcons } from "./icons/registry.ts";

const node: [string, Record<string, string>][] = [["path", { d: "M1 1" }]];

let root: HTMLElement;
beforeEach(() => {
  configureIcons({
    data: {
      icons: { house: node, star: node, rocket: node, "zap-off": node },
      aliases: { home: "house" },
    },
    keywords: { house: ["home", "living"], star: ["favorite"] },
  });
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => {
  render(null, root);
  root.remove();
});

async function mount(
  onPick = vi.fn(),
  onCancel = vi.fn(),
  value: string | null = null,
) {
  await act(async () => {
    render(h(IconPicker, { value, onPick, onCancel, autoFocus: true }), root);
  });
  return { onPick, onCancel };
}

async function key(k: string) {
  await act(async () => {
    root
      .querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
}

const status = () => root.querySelector(".sb-icon-picker-status")!.textContent;

async function search(text: string) {
  const input = root.querySelector("input")!;
  await act(async () => {
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const shown = () =>
  [...root.querySelectorAll("[data-icon-name]")].map((b) =>
    b.getAttribute("data-icon-name"),
  );

test("before searching, shows suggested icons that exist", async () => {
  await mount();
  expect(shown()).toEqual(["star", "rocket", "house"]);
});

test("the current icon is pinned first, even when given by an alias", async () => {
  await mount(vi.fn(), vi.fn(), "home");
  expect(shown()[0]).toBe("house");
  await mount(vi.fn(), vi.fn(), "zap-off");
  expect(shown()).toEqual(["zap-off", "star", "rocket", "house"]);
});

test("arrow keys move the active icon and Enter picks it", async () => {
  const { onPick } = await mount();
  await key("ArrowRight");
  await key("Enter");
  expect(onPick).toHaveBeenCalledWith("rocket");
});

test("the status line names the active icon", async () => {
  await mount();
  await key("ArrowRight");
  expect(status()).toContain("rocket");
});

test("Remove icon is only offered when an icon is set", async () => {
  await mount();
  expect(root.querySelector(".sb-icon-picker-remove")).toBeNull();
  const { onPick } = await mount(vi.fn(), vi.fn(), "star");
  await act(async () => {
    (root.querySelector(".sb-icon-picker-remove") as HTMLElement).click();
  });
  expect(onPick).toHaveBeenCalledWith(null);
});

test("search matches keywords, not only names", async () => {
  await mount();
  await search("home");
  expect(shown()).toEqual(["house"]);
});

test("an exact name match comes first, then names starting with the search", async () => {
  configureIcons({
    data: {
      icons: { birdhouse: node, house: node, "house-plus": node },
      aliases: {},
    },
  });
  await mount();
  await search("house");
  expect(shown()).toEqual(["house", "house-plus", "birdhouse"]);
});

test("name matches come before keyword matches", async () => {
  configureIcons({
    data: {
      icons: { house: node, "read-more": node, book: node },
      aliases: {},
    },
    keywords: { book: ["read"] },
  });
  await mount();
  await search("read");
  expect(shown()).toEqual(["read-more", "book"]);
});

test("Enter picks the first match", async () => {
  const { onPick } = await mount();
  await search("hou");
  await act(async () => {
    root
      .querySelector("input")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
  });
  expect(onPick).toHaveBeenCalledWith("house");
});

test("Escape cancels", async () => {
  const { onCancel, onPick } = await mount();
  await act(async () => {
    root
      .querySelector("input")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
  });
  expect(onCancel).toHaveBeenCalled();
  expect(onPick).not.toHaveBeenCalled();
});

test("clicking an icon picks it", async () => {
  const { onPick } = await mount();
  await act(async () => {
    (root.querySelector('[data-icon-name="star"]') as HTMLElement).click();
  });
  expect(onPick).toHaveBeenCalledWith("star");
});
